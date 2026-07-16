/**
 * Unit tests for the whole-grid global actions bound to the VSN1 side buttons
 * (project effects_v2 / party_integration): "reset all effects to default" and
 * "disable all effects (blackout)". These act on ALL slots across ALL pages.
 *
 * Contract:
 *   resetAllToDefault:
 *     - restores EVERY slot's primary intensity AND mode to the effect's
 *       registry default (drops the touched value + param override),
 *     - does NOT change enabled/active state or the effect assignment,
 *     - re-dispatches RUNNING effects so the reset applies live,
 *     - skips effects with no primary / no mode (heterogeneous grid, not error),
 *     - is idempotent (all-default grid → clean no-op, reset count 0).
 *   disableAll:
 *     - turns OFF every currently-active effect (blackout),
 *     - LEAVES every binding intact (effectId/presetId/label/intensity/mode),
 *     - is behavior-aware: toggles/holds deactivate, a ringing trigger is
 *       silenced at the controller voice pool,
 *     - is idempotent (all-off grid → clean no-op, disabled count 0).
 *
 * Run: node --test tests/global_effect_grid_actions.test.js
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  GlobalEffectSlotManager,
} from '../../lib/global_effect_slot_manager.js';
import { GlobalEffectsController } from '../../lib/global_effects_controller.js';
import {
  getPrimaryIntensity,
  getPrimaryMode,
  mapPrimaryTo01,
} from '../../lib/global_effect_library.js';

function makeManager() {
  const ctrl = new GlobalEffectsController({ engine: { fps: 40 } });
  const mgr = new GlobalEffectSlotManager(ctrl);
  return { ctrl, mgr };
}

// ── resetAllToDefault ────────────────────────────────────────────────

test('resetAllToDefault restores every slot intensity + mode to default', () => {
  const { mgr } = makeManager();
  // Touch intensity + mode on the two strobe slots (1 = sync_4hz, 6 = max_20hz).
  mgr.setSlotIntensity(1, 0.9);
  mgr.setSlotMode(1, 4);            // hz=4 (a non-default member)
  mgr.setSlotIntensity(6, 0.1);
  // Touch a wash slot's intensity too (slot 3 = colorWash).
  mgr.setSlotIntensity(3, 0.25);

  // Sanity: they moved off default.
  const before = mgr.getStatus();
  const s1b = before.find(s => s.slotId === 1);
  assert.equal(s1b.intensity, 0.9);
  assert.equal(s1b.mode, 4);

  const result = mgr.resetAllToDefault();

  // Every touched slot is reported reset on the right dimension.
  assert.deepEqual(result.intensityReset.sort((a, b) => a - b), [1, 3, 6]);
  assert.deepEqual(result.modeReset, [1]);
  assert.deepEqual(result.slotsReset.sort((a, b) => a - b), [1, 3, 6]);

  const after = mgr.getStatus();
  for (const slotId of [1, 3, 6]) {
    const s = after.find(x => x.slotId === slotId);
    // Reported intensity is back to the effect default.
    assert.equal(s.intensity, s.intensityDefault, `slot ${slotId} intensity reset`);
  }
  // Mode back to strobe default (hz=2).
  const s1 = after.find(s => s.slotId === 1);
  assert.equal(s1.mode, getPrimaryMode('strobe').default);
});

test('resetAllToDefault drops the param overrides so preset/default governs', () => {
  const { mgr } = makeManager();
  const intParam = getPrimaryIntensity('strobe').param;
  const modeParam = getPrimaryMode('strobe').param;
  mgr.setSlotIntensity(1, 0.7);
  mgr.setSlotMode(1, 10);
  const slot = mgr.getSlot(1);
  assert.ok(Object.prototype.hasOwnProperty.call(slot.paramsOverride, intParam));
  assert.ok(Object.prototype.hasOwnProperty.call(slot.paramsOverride, modeParam));

  mgr.resetAllToDefault();

  assert.equal(Object.prototype.hasOwnProperty.call(slot.paramsOverride, intParam), false);
  assert.equal(Object.prototype.hasOwnProperty.call(slot.paramsOverride, modeParam), false);
  assert.equal(slot.intensity, null);
  assert.equal(slot.mode, null);
});

test('resetAllToDefault does NOT change enabled/active state or assignment', () => {
  const { ctrl, mgr } = makeManager();
  // Activate a couple of slots and touch their values.
  mgr.dispatchSlotAction({ slotId: 3, action: 'activate', frameIndex: 0, nowMs: 0 }); // colorWash
  mgr.setSlotIntensity(3, 0.2);
  mgr.dispatchSlotAction({ slotId: 4, action: 'activate', frameIndex: 0, nowMs: 0 }); // feedbackTrails
  assert.equal(mgr.getStatus().find(s => s.slotId === 3).active, true);
  assert.equal(mgr.getStatus().find(s => s.slotId === 4).active, true);

  const beforeSlots = mgr.getSlots();
  mgr.resetAllToDefault();
  const afterSlots = mgr.getSlots();

  // Still active — reset touched VALUES only.
  assert.equal(mgr.getStatus().find(s => s.slotId === 3).active, true);
  assert.equal(mgr.getStatus().find(s => s.slotId === 4).active, true);
  assert.equal(!!ctrl.colorWashConfig.enabled, true);
  assert.equal(!!ctrl.feedbackTrailsConfig.enabled, true);
  // Bindings (effectId/presetId/enabled/label) unchanged for every slot.
  for (let i = 0; i < beforeSlots.length; i++) {
    assert.equal(afterSlots[i].effectId, beforeSlots[i].effectId);
    assert.equal(afterSlots[i].presetId, beforeSlots[i].presetId);
    assert.equal(afterSlots[i].enabled, beforeSlots[i].enabled);
    assert.equal(afterSlots[i].label, beforeSlots[i].label);
  }
});

test('resetAllToDefault re-dispatches a RUNNING effect so the reset applies live', () => {
  const { ctrl, mgr } = makeManager();
  // Activate colorWash slot then move its intensity live.
  mgr.dispatchSlotAction({ slotId: 3, action: 'activate', frameIndex: 0, nowMs: 0 });
  mgr.setSlotIntensity(3, 0.15);
  const liveAmountTouched = ctrl.colorWashConfig.amount;

  const result = mgr.resetAllToDefault({ frameIndex: 0, nowMs: 0 });
  assert.ok(result.reapplied.includes(3), 'running wash slot should be reapplied');
  // The live wash amount now reflects the default preset amount, not the touched one.
  assert.notEqual(ctrl.colorWashConfig.amount, liveAmountTouched);
});

test('resetAllToDefault on an all-default grid is a clean no-op (idempotent)', () => {
  const { mgr } = makeManager();
  const r1 = mgr.resetAllToDefault();
  assert.deepEqual(r1.slotsReset, []);
  assert.deepEqual(r1.intensityReset, []);
  assert.deepEqual(r1.modeReset, []);
  // And running twice after a real reset is still a no-op the second time.
  mgr.setSlotIntensity(1, 0.8);
  const r2 = mgr.resetAllToDefault();
  assert.deepEqual(r2.slotsReset, [1]);
  const r3 = mgr.resetAllToDefault();
  assert.deepEqual(r3.slotsReset, []);
});

test('resetAllToDefault skips no-primary / no-mode effects without error', () => {
  const { mgr } = makeManager();
  // Slot 9 = invert (no primary intensity, no mode). It must be untouched and
  // must not throw during the sweep.
  const invertSlot = mgr.getSlot(9);
  assert.equal(invertSlot.effectId, 'invert');
  assert.doesNotThrow(() => mgr.resetAllToDefault());
  // Invert never appears in any reset list.
  const r = mgr.resetAllToDefault();
  assert.equal(r.intensityReset.includes(9), false);
  assert.equal(r.modeReset.includes(9), false);
});

// ── disableAll ───────────────────────────────────────────────────────

test('disableAll turns OFF all active toggle slots and keeps bindings', () => {
  const { ctrl, mgr } = makeManager();
  mgr.dispatchSlotAction({ slotId: 1, action: 'activate', frameIndex: 0, nowMs: 0 }); // strobe
  mgr.dispatchSlotAction({ slotId: 3, action: 'activate', frameIndex: 0, nowMs: 0 }); // colorWash
  mgr.dispatchSlotAction({ slotId: 4, action: 'activate', frameIndex: 0, nowMs: 0 }); // feedbackTrails
  assert.equal(ctrl.strobeActive, true);
  assert.equal(!!ctrl.colorWashConfig.enabled, true);
  assert.equal(!!ctrl.feedbackTrailsConfig.enabled, true);

  const beforeSlots = mgr.getSlots();
  const result = mgr.disableAll({ frameIndex: 0, nowMs: 0 });

  assert.deepEqual(result.disabled.sort((a, b) => a - b), [1, 3, 4]);
  assert.equal(ctrl.strobeActive, false);
  assert.equal(!!ctrl.colorWashConfig.enabled, false);
  assert.equal(!!ctrl.feedbackTrailsConfig.enabled, false);
  // Every slot is now inactive.
  for (const s of mgr.getStatus()) assert.equal(s.active, false, `slot ${s.slotId} off`);
  // Bindings intact — this is "stop all", not "clear the layout".
  const afterSlots = mgr.getSlots();
  for (let i = 0; i < beforeSlots.length; i++) {
    assert.equal(afterSlots[i].effectId, beforeSlots[i].effectId);
    assert.equal(afterSlots[i].presetId, beforeSlots[i].presetId);
    assert.equal(afterSlots[i].enabled, beforeSlots[i].enabled);
    assert.equal(afterSlots[i].label, beforeSlots[i].label);
  }
});

test('disableAll preserves a slot\'s touched intensity/mode (values kept)', () => {
  const { mgr } = makeManager();
  mgr.dispatchSlotAction({ slotId: 1, action: 'activate', frameIndex: 0, nowMs: 0 });
  mgr.setSlotIntensity(1, 0.85);
  mgr.setSlotMode(1, 5);

  mgr.disableAll();

  const s = mgr.getStatus().find(x => x.slotId === 1);
  assert.equal(s.active, false, 'slot turned off');
  assert.equal(s.intensity, 0.85, 'touched intensity preserved');
  assert.equal(s.mode, 5, 'touched mode preserved');
});

test('disableAll silences a ringing trigger (dropHit) at the voice pool', () => {
  const { ctrl, mgr } = makeManager();
  // Fire the Iceberg-Flash trigger (slot 2 = dropHit). It rings out over its
  // release envelope, so the slot is ACTIVE right after firing.
  mgr.dispatchSlotAction({ slotId: 2, action: 'trigger', frameIndex: 0, nowMs: 0 });
  assert.equal(ctrl.dropHitActive, true, 'dropHit ringing after trigger');

  const result = mgr.disableAll({ frameIndex: 0, nowMs: 0 });
  assert.ok(result.disabled.includes(2), 'ringing trigger slot reported disabled');
  assert.equal(ctrl.dropHitActive, false, 'ringing trigger silenced');
  // Binding stays — the dropHit slot is still bound, just no longer ringing.
  assert.equal(mgr.getSlot(2).effectId, 'dropHit');
});

test('disableAll on an all-off grid is a clean no-op (idempotent)', () => {
  const { mgr } = makeManager();
  const r1 = mgr.disableAll();
  assert.deepEqual(r1.disabled, []);
  // Activate one, disable-all once → it turns off; a second disable-all is a no-op.
  mgr.dispatchSlotAction({ slotId: 3, action: 'activate', frameIndex: 0, nowMs: 0 });
  const r2 = mgr.disableAll();
  assert.deepEqual(r2.disabled, [3]);
  const r3 = mgr.disableAll();
  assert.deepEqual(r3.disabled, []);
});

test('disableAll leaves an already-inactive bound slot untouched', () => {
  const { mgr } = makeManager();
  // No slots active. disableAll should not toggle anything ON or error.
  const before = mgr.getStatus().map(s => s.active);
  mgr.disableAll();
  const after = mgr.getStatus().map(s => s.active);
  assert.deepEqual(after, before);
  assert.ok(after.every(a => a === false));
});

// ── controller helper ────────────────────────────────────────────────

test('clearDropHits returns the number of voices cleared and empties the pool', () => {
  const ctrl = new GlobalEffectsController({ engine: { fps: 40 } });
  assert.equal(ctrl.clearDropHits(), 0, 'no voices → 0');
  ctrl.triggerDropHit({ color: '#fff', intensity: 1, attackMs: 5, holdMs: 5, releaseMs: 50 }, 0);
  ctrl.triggerDropHit({ color: '#fff', intensity: 1, attackMs: 5, holdMs: 5, releaseMs: 50 }, 0);
  assert.equal(ctrl.dropHitActive, true);
  assert.equal(ctrl.clearDropHits(), 2, 'cleared both voices');
  assert.equal(ctrl.dropHitActive, false);
});
