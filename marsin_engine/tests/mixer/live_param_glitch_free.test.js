// Live-param GLITCH-FREE contract (glitch-fix campaign 2026-07).
//
// The operator tunes a GEM slot's primary intensity (VSN1 jog-wheel / UI
// slider → setSlotIntensity) and primary mode (VSN1 encoder press →
// cycleSlotMode / setSlotMode) WHILE the effect is running. Every such live
// change must apply IN PLACE on the next frame: continuous params take effect
// smoothly WITHOUT resetting phase / envelope / buffers, and a discrete mode
// change transitions cleanly (re-quantize, never blank).
//
// These are pure library/manager/controller unit tests — they never spawn the
// engine, a server, the audio companion, or the VSN1 deploy child process, and
// they never touch the real marsin_engine/states tree.
//
// Run: node --test tests/live_param_glitch_free.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  GlobalEffectSlotManager,
  DEFAULT_SLOT_CONFIG,
} from '../../lib/global_effect_slot_manager.js';
import { GlobalEffectsController } from '../../lib/global_effects_controller.js';
import { strobeEffect } from '../../effects/strobe.js';

function mk() {
  const ctrl = new GlobalEffectsController({ engine: { fps: 40 } });
  const mgr = new GlobalEffectSlotManager(ctrl, DEFAULT_SLOT_CONFIG);
  return { ctrl, mgr };
}

// Bind a scratch slot (5) to an arbitrary effect+preset and activate it.
function bindActive(mgr, effectId, presetId, behavior, { frameIndex = 0, nowMs = 0 } = {}) {
  mgr.patchSlot(5, { enabled: true, label: effectId, effectId, presetId, behavior });
  mgr.dispatchSlotAction({ slotId: 5, action: 'activate', frameIndex, nowMs });
  return 5;
}

// The strobe ON/OFF gate at a given frame, for the current controller config.
function strobeGate(ctrl, frameIndex) {
  const c = ctrl.strobeConfig;
  return strobeEffect.getGate({
    frameIndex,
    startedAtFrame: ctrl.strobeStartedAtFrame,
    framesPerCycle: c.framesPerCycle,
    onFrames: c.onFrames,
  });
}

// ════════════════════════════════════════════════════════════════════
// STROBE / Pulse — the marquee case
// ════════════════════════════════════════════════════════════════════

test('strobe: live intensity change PRESERVES the phase anchor (no cycle restart)', () => {
  const { ctrl, mgr } = mk();
  // Slot 6 = 20 Hz Max strobe, toggle.
  mgr.dispatchSlotAction({ slotId: 6, action: 'activate', frameIndex: 0, nowMs: 0 });
  const anchorBefore = ctrl.strobeStartedAtFrame;
  assert.equal(anchorBefore, 0);
  // Operator jogs Flash Strength mid-run at frame 137.
  const r = mgr.setSlotIntensity(6, 0.5, { frameIndex: 137, nowMs: 3425 });
  assert.equal(r.applied, true, 're-dispatched live');
  // Anchor is UNCHANGED — the gate keeps ticking where it was (pre-fix this
  // jumped to 137 and the pulse train restarted → dark hiccup).
  assert.equal(ctrl.strobeStartedAtFrame, anchorBefore, 'phase anchor preserved');
  assert.equal(ctrl.strobeConfig.intensity, 0.5, 'new flash strength applied live');
});

test('strobe: the gate value on the tweak frame is identical before and after an intensity tweak', () => {
  const { ctrl, mgr } = mk();
  mgr.dispatchSlotAction({ slotId: 6, action: 'activate', frameIndex: 0, nowMs: 0 });
  // Sweep a run of frames; at each, a live intensity tweak must NOT flip the
  // gate on that frame (continuity of the ON/OFF pattern).
  for (const f of [1, 2, 3, 4, 5, 50, 137, 999]) {
    // Fresh controller each iter so we measure the gate the frame WOULD have
    // had vs. the gate after a tweak on that same frame.
    const g0 = strobeGate(ctrl, f);
    mgr.setSlotIntensity(6, 0.3 + (f % 5) * 0.1, { frameIndex: f, nowMs: f * 25 });
    const g1 = strobeGate(ctrl, f);
    assert.equal(g1, g0, `gate continuity broken at frame ${f}`);
  }
});

test('strobe: hz mode-cycle RE-QUANTIZES the phase (fraction carried, never blanks)', () => {
  const { ctrl, mgr } = mk();
  mgr.patchSlot(1, { enabled: true, effectId: 'strobe', presetId: 'sync_4hz', behavior: 'toggle' });
  mgr.dispatchSlotAction({ slotId: 1, action: 'activate', frameIndex: 0, nowMs: 0 });

  const F = 137;
  const cfgA = ctrl.strobeConfig;
  const localA = F - ctrl.strobeStartedAtFrame;
  const fracA = (((localA % cfgA.framesPerCycle) + cfgA.framesPerCycle) % cfgA.framesPerCycle) / cfgA.framesPerCycle;

  // Encoder press: 4 Hz → 10 Hz mid-run.
  const r = mgr.setSlotMode(1, 10, { frameIndex: F, nowMs: F * 25 });
  assert.equal(r.applied, true);
  assert.equal(ctrl.strobeConfig.hz, 10, 'live rate followed the mode');

  const cfgB = ctrl.strobeConfig;
  const localB = F - ctrl.strobeStartedAtFrame;
  const fracB = (((localB % cfgB.framesPerCycle) + cfgB.framesPerCycle) % cfgB.framesPerCycle) / cfgB.framesPerCycle;

  // The cycle LENGTH changed (fpc differs) but the operator's fractional
  // position within the cycle is carried across, within one new-cycle frame
  // of quantization — NOT snapped back to a fresh cycle start (frac 0).
  assert.notEqual(cfgA.framesPerCycle, cfgB.framesPerCycle, 'cycle length actually changed');
  const quantStep = 1 / cfgB.framesPerCycle;
  assert.ok(
    Math.abs(fracA - fracB) <= quantStep + 1e-9,
    `phase fraction not carried: ${fracA} -> ${fracB} (step ${quantStep})`,
  );
});

test('strobe: walking ALL FIVE Pulse frequencies mid-run carries the phase fraction each step', () => {
  const { ctrl, mgr } = mk();
  mgr.patchSlot(1, { enabled: true, effectId: 'strobe', presetId: 'pulse_2hz', behavior: 'toggle' });
  mgr.dispatchSlotAction({ slotId: 1, action: 'activate', frameIndex: 0, nowMs: 0 });
  // Evaluate continuity on a FIXED frame so the only thing that moves is the
  // cycle grid (each cycle change re-quantizes to preserve the fraction).
  const FRAME = 500;
  const frac = () => {
    const c = ctrl.strobeConfig;
    const local = FRAME - ctrl.strobeStartedAtFrame;
    return (((local % c.framesPerCycle) + c.framesPerCycle) % c.framesPerCycle) / c.framesPerCycle;
  };
  for (let i = 0; i < 6; i++) {
    const before = frac();
    mgr.cycleSlotMode(1, { frameIndex: FRAME, nowMs: FRAME * 25 });
    const after = frac();
    // Fraction carried within one new-cycle quantization step — never snapped
    // to a fresh cycle start (the pre-fix hard restart set anchor = FRAME → 0).
    const step = 1 / ctrl.strobeConfig.framesPerCycle;
    assert.ok(
      Math.abs(before - after) <= step + 1e-9,
      `hz step ${i} broke phase continuity: ${before} -> ${after} (step ${step})`,
    );
    assert.ok([0, 1].includes(strobeGate(ctrl, FRAME)), 'gate still coherent');
  }
});

test('strobe: an INACTIVE slot intensity write does not start a strobe (no spurious flash)', () => {
  const { ctrl, mgr } = mk();
  const r = mgr.setSlotIntensity(6, 0.5, { frameIndex: 0, nowMs: 0 });
  assert.equal(r.applied, false);
  assert.equal(ctrl.strobeActive, false);
});

// ════════════════════════════════════════════════════════════════════
// FEEDBACK TRAILS — buffer must survive a live tweak
// ════════════════════════════════════════════════════════════════════

test('trails: live intensity (Trail Mix) change does NOT clear the trail buffer', () => {
  const { ctrl, mgr } = mk();
  // Slot 4 = ghost_ship (resetOnEnable: true).
  mgr.dispatchSlotAction({ slotId: 4, action: 'activate', frameIndex: 0, nowMs: 0 });
  ctrl._ensureFeedbackBuffer(8);
  ctrl.feedbackTrailBuffer.fill(0.42);
  const sumBefore = ctrl.feedbackTrailBuffer.reduce((a, b) => a + b, 0);
  assert.ok(sumBefore > 0);

  const r = mgr.setSlotIntensity(4, 0.85, { frameIndex: 50, nowMs: 1250 });
  assert.equal(r.applied, true);
  assert.ok(ctrl.feedbackTrailBuffer, 'buffer still allocated (not freed)');
  const sumAfter = ctrl.feedbackTrailBuffer.reduce((a, b) => a + b, 0);
  assert.equal(sumAfter, sumBefore, 'trail history preserved across the tweak');
  assert.equal(ctrl.feedbackTrailsConfig.params.mix, 0.85, 'new mix applied live');
});

test('trails: live mode (Blend) change does NOT clear the buffer and applies the new blend', () => {
  const { ctrl, mgr } = mk();
  mgr.dispatchSlotAction({ slotId: 4, action: 'activate', frameIndex: 0, nowMs: 0 });
  ctrl._ensureFeedbackBuffer(8);
  ctrl.feedbackTrailBuffer.fill(0.3);
  const sumBefore = ctrl.feedbackTrailBuffer.reduce((a, b) => a + b, 0);
  // ghost_ship default blendMode is 'replace' → cycle to 'max'.
  mgr.setSlotMode(4, 'max', { frameIndex: 10, nowMs: 250 });
  const sumAfter = ctrl.feedbackTrailBuffer.reduce((a, b) => a + b, 0);
  assert.equal(sumAfter, sumBefore, 'buffer preserved across a blend-mode change');
  assert.equal(ctrl.feedbackTrailsConfig.params.blendMode, 'max');
});

test('trails: a GENUINE fresh enable (off→on) still honours resetOnEnable', () => {
  const { ctrl, mgr } = mk();
  mgr.dispatchSlotAction({ slotId: 4, action: 'activate', frameIndex: 0, nowMs: 0 });
  ctrl._ensureFeedbackBuffer(8);
  ctrl.feedbackTrailBuffer.fill(0.5);
  // Turn OFF immediately, then back ON — this is a real re-enable, so the
  // resetOnEnable clean-slate must fire (the buffer is freed on immediate off
  // and re-allocated clean on enable).
  mgr.dispatchSlotAction({ slotId: 4, action: 'deactivate', frameIndex: 5, nowMs: 100 });
  mgr.dispatchSlotAction({ slotId: 4, action: 'activate', frameIndex: 6, nowMs: 200 });
  // Either freed (null) or a zeroed fresh buffer — never the stale 0.5 fill.
  const buf = ctrl.feedbackTrailBuffer;
  if (buf) {
    const sum = buf.reduce((a, b) => a + b, 0);
    assert.equal(sum, 0, 'fresh enable starts from a clean (zero) buffer');
  }
  assert.equal(ctrl.feedbackTrailsConfig.enabled, true);
});

// ════════════════════════════════════════════════════════════════════
// COLOR WASH — in-place amount/mode, consistent config
// ════════════════════════════════════════════════════════════════════

test('colorWash: live amount + mode changes apply in place on the SAME config object', () => {
  const { ctrl, mgr } = mk();
  // Slot 3 = ocean_blue wash.
  mgr.dispatchSlotAction({ slotId: 3, action: 'activate', frameIndex: 0, nowMs: 0 });
  const cfgRef = ctrl.colorWashConfig;
  assert.equal(cfgRef.amount, 0.7);
  mgr.setSlotIntensity(3, 0.25, { frameIndex: 0, nowMs: 10 });
  assert.equal(ctrl.colorWashConfig, cfgRef, 'config object identity preserved (in-place)');
  assert.equal(ctrl.colorWashConfig.amount, 0.25, 'wash depth applied live');
  mgr.setSlotMode(3, 'replace', { frameIndex: 0, nowMs: 20 });
  assert.equal(ctrl.colorWashConfig.mode, 'replace', 'blend mode applied live');
  assert.equal(ctrl.colorWashConfig.enabled, true);
});

// ════════════════════════════════════════════════════════════════════
// PARTY EFFECTS — already in-place setters; lock the contract
// ════════════════════════════════════════════════════════════════════

test('party toggle effects: live intensity change mutates config IN PLACE (no re-enable churn)', () => {
  // effectId, preset, the runtime config object on the controller, and the
  // continuous param the jog-wheel writes.
  const cases = [
    { id: 'beatPump',       preset: 'soft',        cfg: (c) => c.beatPump, param: 'depth' },
    { id: 'waterlineSweep', preset: 'rising_tide', cfg: (c) => c.sweep,    param: 'amount' },
    { id: 'crush',          preset: 'bold_4',      cfg: (c) => c.crush,    param: 'amount' },
    { id: 'breath',         preset: 'calm',        cfg: (c) => c.breath,   param: 'depth' },
    { id: 'sparkle',        preset: 'fizz',        cfg: (c) => c.sparkle,  param: 'density' },
  ];
  for (const { id, preset, cfg, param } of cases) {
    const { ctrl, mgr } = mk();
    bindActive(mgr, id, preset, 'toggle');
    const ref = cfg(ctrl);
    assert.equal(ref.enabled, true, `${id} active`);
    const r = mgr.setSlotIntensity(5, 0.31, { frameIndex: 7, nowMs: 175 });
    assert.equal(r.applied, true, `${id} re-applied live`);
    // Same config object — the setter mutates fields, never rebuilds/re-enables.
    assert.equal(cfg(ctrl), ref, `${id} config object identity preserved`);
    assert.equal(cfg(ctrl).enabled, true, `${id} stays enabled across the tweak`);
    // The mapped value landed on the effect's continuous param.
    assert.ok(typeof cfg(ctrl)[param] === 'number', `${id}.${param} numeric`);
  }
});

test('sparkle: live density change PRESERVES the live glint field (state holder untouched)', () => {
  const { ctrl, mgr } = mk();
  bindActive(mgr, 'sparkle', 'blizzard', 'toggle');
  const stateRef = ctrl._sparkleState;
  // Force some live glints into the field.
  ctrl._sparkleState.spark = new Float32Array([0.9, 0, 0.5, 0]);
  ctrl._sparkleState.activeCount = 2;
  mgr.setSlotIntensity(5, 0.05, { frameIndex: 3, nowMs: 75 });
  assert.equal(ctrl._sparkleState, stateRef, 'sparkle state holder identity preserved');
  assert.equal(ctrl._sparkleState.activeCount, 2, 'live glints not cleared by a density tweak');
  assert.ok(Math.abs(ctrl._sparkleState.spark[0] - 0.9) < 1e-6, 'glint energy intact');
});

test('breath: live depth change keeps the self-clocked phase continuous (no phase state to reset)', () => {
  // Ocean Breath is self-clocked off nowMs; its config setter mutates in place.
  // A live depth tweak must not change periodMs (the clock) — proving the phase
  // continues uninterrupted.
  const { ctrl, mgr } = mk();
  bindActive(mgr, 'breath', 'deep', 'toggle');
  const periodBefore = ctrl.breath.periodMs;
  mgr.setSlotIntensity(5, 0.5, { frameIndex: 0, nowMs: 5000 });
  assert.equal(ctrl.breath.periodMs, periodBefore, 'breath period (clock) unchanged by a depth tweak');
  assert.equal(ctrl.breath.enabled, true);
});

test('freeze: live Hold-Fade change does NOT re-capture the frozen frame', () => {
  // Freeze holds a captured buffer + engagedAtMs in _freezeState. A live
  // holdFadeMs tweak (jog-wheel / Hold mode cycle) must not release/re-capture.
  const { ctrl, mgr } = mk();
  bindActive(mgr, 'freeze', 'fade_2s', 'toggle');
  // Simulate a capture having happened.
  ctrl._freezeState.captured = true;
  ctrl._freezeState.engagedAtMs = 1000;
  const stateRef = ctrl._freezeState;
  mgr.setSlotIntensity(5, 0.5, { frameIndex: 0, nowMs: 4000 }); // holdFadeMs 5000
  assert.equal(ctrl._freezeState, stateRef, 'freeze state holder identity preserved');
  assert.equal(ctrl._freezeState.captured, true, 'freeze NOT re-captured by a param tweak');
  assert.equal(ctrl._freezeState.engagedAtMs, 1000, 'engage timestamp preserved');
  assert.equal(ctrl.freeze.active, true);
});

test('kickPunch (auto router, toggle): live intensity re-arms in place without dropping the fire clock', () => {
  const { ctrl, mgr } = mk();
  bindActive(mgr, 'kickPunch', 'punch', 'toggle');
  assert.equal(ctrl.kickRouter.enabled, true);
  // Simulate a recent fire so we can prove the min-gap clock is not reset.
  ctrl._kickLastFireMs = 900;
  const r = mgr.setSlotIntensity(5, 0.7, { frameIndex: 0, nowMs: 1000 });
  assert.equal(r.applied, true, 'toggle-router re-arm is allowed through');
  assert.equal(ctrl.kickRouter.enabled, true, 'router stays armed');
  assert.equal(ctrl._kickLastFireMs, 900, 'last-fire clock not reset (no double-fire on next kick)');
});

// ════════════════════════════════════════════════════════════════════
// Trigger effects — nothing running to update; no spurious fire
// ════════════════════════════════════════════════════════════════════

test('dropHit (trigger): live intensity change never fires a spurious hit', () => {
  const { ctrl, mgr } = mk();
  // Slot 2 = White Drop trigger. Fire one so a voice is ringing.
  mgr.dispatchSlotAction({ slotId: 2, action: 'trigger', frameIndex: 0, nowMs: 0 });
  const before = ctrl.dropHits.length;
  const r = mgr.setSlotIntensity(2, 0.4, { frameIndex: 1, nowMs: 30 });
  assert.equal(r.applied, false, 'trigger effects are not re-dispatched');
  assert.equal(ctrl.dropHits.length, before, 'no extra voice spawned');
  assert.equal(mgr.getSlot(2).paramsOverride.intensity, 0.4, 'next fire picks up the new punch');
});

// ════════════════════════════════════════════════════════════════════
// Cross-cutting: reset-all mid-run stays continuous too
// ════════════════════════════════════════════════════════════════════

test('resetAllToDefault mid-run re-applies live without resetting strobe phase or trail buffer', () => {
  const { ctrl, mgr } = mk();
  // Run a strobe (slot 6) and a trails (slot 4), touch both intensities.
  mgr.dispatchSlotAction({ slotId: 6, action: 'activate', frameIndex: 0, nowMs: 0 });
  mgr.dispatchSlotAction({ slotId: 4, action: 'activate', frameIndex: 0, nowMs: 0 });
  mgr.setSlotIntensity(6, 0.5, { frameIndex: 100, nowMs: 2500 });
  mgr.setSlotIntensity(4, 0.9, { frameIndex: 100, nowMs: 2500 });
  ctrl._ensureFeedbackBuffer(8);
  ctrl.feedbackTrailBuffer.fill(0.2);
  const anchorBefore = ctrl.strobeStartedAtFrame;
  const trailSumBefore = ctrl.feedbackTrailBuffer.reduce((a, b) => a + b, 0);

  mgr.resetAllToDefault({ frameIndex: 200, nowMs: 5000 });

  assert.equal(ctrl.strobeStartedAtFrame, anchorBefore, 'reset-all preserved strobe phase');
  assert.equal(
    ctrl.feedbackTrailBuffer.reduce((a, b) => a + b, 0), trailSumBefore,
    'reset-all preserved the trail buffer',
  );
  // Params are back to defaults, live.
  assert.equal(ctrl.strobeConfig.intensity, 1.0, 'strobe intensity reset to default live');
  assert.equal(ctrl.feedbackTrailsConfig.params.mix, 0.6, 'ghost_ship mix reset to default live');
});
