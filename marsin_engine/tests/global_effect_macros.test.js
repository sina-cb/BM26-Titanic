// Unit tests for the Global Effect Macros system (docs/28 §9.1).
// Run:  node --test tests/global_effect_macros.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  GLOBAL_EFFECT_LIBRARY,
  SAFETY_TIERS,
  MAX_BURST_MS,
  describeLibrary,
  validateParams,
  validateColor6,
} from '../lib/global_effect_library.js';
import {
  GlobalEffectSlotManager,
  DEFAULT_SLOT_CONFIG,
  resolveSlotBinding,
  validateSlotsConfig,
} from '../lib/global_effect_slot_manager.js';
import { GlobalEffectsController } from '../lib/global_effects_controller.js';
import { getFrameLockedStrobeTiming, getFrameLockedStrobeGate, applySoftwareStrobe } from '../effects/strobe.js';
import { envelopeValue, envelopeDurationMs, applyDropHit } from '../effects/dropHit.js';
import { applyColorWash } from '../effects/colorWash.js';
import { applyFeedbackTrails } from '../effects/feedbackTrails.js';

function makePixels(n = 4) {
  const out = [];
  for (let i = 0; i < n; i++) {
    out.push({ r: 0.5, g: 0.4, b: 0.3, w: 0.2, a: 0.1, u: 0.05 });
  }
  return out;
}

// ── Library + slot configuration ─────────────────────────────────────

test('default slot config validates against v1 library', () => {
  assert.doesNotThrow(() => validateSlotsConfig(DEFAULT_SLOT_CONFIG));
  assert.equal(DEFAULT_SLOT_CONFIG.length, 6);
});

test('no default slot references a future/unimplemented effect', () => {
  const v1Ids = new Set(Object.keys(GLOBAL_EFFECT_LIBRARY));
  for (const slot of DEFAULT_SLOT_CONFIG) {
    assert.ok(v1Ids.has(slot.effectId),
      `slot ${slot.slotId} references unknown effect '${slot.effectId}'`);
    const preset = GLOBAL_EFFECT_LIBRARY[slot.effectId].presets[slot.presetId];
    assert.ok(preset, `slot ${slot.slotId} references unknown preset '${slot.presetId}'`);
  }
});

test('describeLibrary returns serializable metadata for all v1 effects', () => {
  const desc = describeLibrary();
  assert.ok(desc.strobe);
  assert.ok(desc.dropHit);
  assert.ok(desc.colorWash);
  assert.ok(desc.feedbackTrails);
  // Roundtrip through JSON to confirm no function refs leaked.
  const round = JSON.parse(JSON.stringify(desc));
  assert.deepEqual(round, desc);
  // Spot-check presets
  assert.equal(desc.strobe.presets.max_20hz.safetyTier, SAFETY_TIERS.EXPERT_BURST);
  assert.equal(desc.strobe.presets.hard_10hz.safetyTier, SAFETY_TIERS.HOLD_ONLY);
});

test('validateParams rejects unknown effectId', () => {
  assert.throws(() => validateParams('lightningStrike', {}), /Unknown effectId/);
});

test('validateParams clamps burst durationMs to MAX_BURST_MS', () => {
  const out = validateParams('strobe', { durationMs: 5000 });
  assert.equal(out.durationMs, MAX_BURST_MS);
});

test('validateParams rejects strobe.hz outside [1..20]', () => {
  assert.throws(() => validateParams('strobe', { hz: 0 }), /out of safety range/);
  assert.throws(() => validateParams('strobe', { hz: 25 }), /out of safety range/);
  assert.doesNotThrow(() => validateParams('strobe', { hz: 4 }));
});

test('validateParams rejects strobe.duty outside [0.05..0.95]', () => {
  assert.throws(() => validateParams('strobe', { duty: 0.01 }));
  assert.throws(() => validateParams('strobe', { duty: 1.0 }));
});

test('validateColor6 rejects wrong shape and out-of-range', () => {
  assert.throws(() => validateColor6([1, 2, 3]));
  assert.throws(() => validateColor6([0, 0, 0, 0, 0, 2]));
  assert.doesNotThrow(() => validateColor6([0, 0.5, 1, 0.2, 0.1, 0]));
});

test('validateSlotsConfig rejects wrong length, duplicate slotIds', () => {
  assert.throws(() => validateSlotsConfig(DEFAULT_SLOT_CONFIG.slice(0, 5)),
    /exactly 6 entries/);
  const dup = JSON.parse(JSON.stringify(DEFAULT_SLOT_CONFIG));
  dup[1].slotId = 1;
  assert.throws(() => validateSlotsConfig(dup), /Duplicate slotId/);
});

// ── Safety enforcement ──────────────────────────────────────────────

test('expert_burst preset (max_20hz) rejects toggle and hold behaviors in slot config', () => {
  const bad = JSON.parse(JSON.stringify(DEFAULT_SLOT_CONFIG));
  // Slot 6 is the burst; flip it to toggle.
  bad[5].behavior = 'toggle';
  assert.throws(() => validateSlotsConfig(bad), /expert_burst/);
  bad[5].behavior = 'hold';
  assert.throws(() => validateSlotsConfig(bad), /expert_burst/);
});

test('hold_only preset (hard_10hz) rejects toggle behavior', () => {
  const bad = JSON.parse(JSON.stringify(DEFAULT_SLOT_CONFIG));
  bad[0].effectId = 'strobe';
  bad[0].presetId = 'hard_10hz';
  bad[0].behavior = 'toggle';
  assert.throws(() => validateSlotsConfig(bad), /hold_only/);
});

test('expert_burst slot rejects toggle dispatch action at runtime', () => {
  const ctrl = new GlobalEffectsController({ engine: { fps: 40 } });
  const mgr = new GlobalEffectSlotManager(ctrl);
  // Slot 6 (max_20hz, burst).
  assert.throws(
    () => mgr.dispatchSlotAction({ slotId: 6, action: 'toggle', frameIndex: 0, nowMs: 0 }),
    /expert_burst/,
  );
});

// ── Boot transient cleanliness ──────────────────────────────────────

test('controller boot state is fully transient (strobe off, no envelopes, no buffer)', () => {
  const ctrl = new GlobalEffectsController({ engine: { fps: 40 } });
  assert.equal(ctrl.strobeActive, false);
  assert.equal(ctrl.strobeConfig, null);
  assert.equal(ctrl.dropHitActive, false);
  assert.equal(ctrl.dropHits.length, 0);
  assert.equal(ctrl.colorWashConfig.enabled, false);
  assert.equal(ctrl.feedbackTrailsConfig.enabled, false);
  assert.equal(ctrl.feedbackTrailBuffer, null);
});

// ── Strobe behaviour ────────────────────────────────────────────────

test('getFrameLockedStrobeTiming quantizes to whole frames', () => {
  const t4 = getFrameLockedStrobeTiming({ hz: 4, frameRate: 40 });
  assert.equal(t4.framesPerCycle, 10);
  assert.equal(t4.onFrames, 5);
  assert.equal(t4.actualHz, 4);
  const t20 = getFrameLockedStrobeTiming({ hz: 20, frameRate: 40 });
  assert.equal(t20.framesPerCycle, 2);
  assert.equal(t20.onFrames, 1);
});

test('strobe gate goes ON then OFF on schedule', () => {
  // 4 Hz, 40 fps → 10 frames per cycle, 5 on / 5 off.
  const args = { startedAtFrame: 0, framesPerCycle: 10, onFrames: 5 };
  assert.equal(getFrameLockedStrobeGate({ frameIndex: 0,  ...args }), 1);
  assert.equal(getFrameLockedStrobeGate({ frameIndex: 4,  ...args }), 1);
  assert.equal(getFrameLockedStrobeGate({ frameIndex: 5,  ...args }), 0);
  assert.equal(getFrameLockedStrobeGate({ frameIndex: 9,  ...args }), 0);
  assert.equal(getFrameLockedStrobeGate({ frameIndex: 10, ...args }), 1);
});

test('applySoftwareStrobe blanks pixels when gate=0, scales when gate=1', () => {
  const pixels = makePixels(2);
  applySoftwareStrobe({ pixels, gate: 0, intensity: 1 });
  for (const p of pixels) {
    assert.equal(p.r + p.g + p.b + p.w + p.a + p.u, 0);
  }
  const pixels2 = makePixels(1);
  applySoftwareStrobe({ pixels: pixels2, gate: 1, intensity: 0.5 });
  assert.equal(pixels2[0].r, 0.25);
});

// ── Drop hit envelope ───────────────────────────────────────────────

test('envelopeValue ADSR profile: attack ramp, hold, release ramp, zero after', () => {
  const opts = { attackMs: 100, holdMs: 200, releaseMs: 300 };
  assert.equal(envelopeValue({ elapsedMs: 0,   ...opts }), 0);
  assert.equal(envelopeValue({ elapsedMs: 50,  ...opts }), 0.5);
  assert.equal(envelopeValue({ elapsedMs: 150, ...opts }), 1);
  assert.equal(envelopeValue({ elapsedMs: 300, ...opts }), 1);
  // Release midway:
  assert.ok(Math.abs(envelopeValue({ elapsedMs: 450, ...opts }) - 0.5) < 0.01);
  assert.equal(envelopeValue({ elapsedMs: 700, ...opts }), 0);
});

test('envelopeDurationMs sums all three phases', () => {
  assert.equal(envelopeDurationMs({ attackMs: 25, holdMs: 75, releaseMs: 300 }), 400);
});

test('trigger slot 2 starts a dropHit envelope', () => {
  const ctrl = new GlobalEffectsController({ engine: { fps: 40 } });
  const mgr = new GlobalEffectSlotManager(ctrl);
  assert.equal(ctrl.dropHitActive, false);
  mgr.dispatchSlotAction({ slotId: 2, action: 'trigger', frameIndex: 0, nowMs: 0 });
  assert.equal(ctrl.dropHitActive, true);
  assert.equal(ctrl.dropHits.length, 1);
});

test('drop hit envelope expires after duration', () => {
  const ctrl = new GlobalEffectsController({ engine: { fps: 40 } });
  const mgr = new GlobalEffectSlotManager(ctrl);
  mgr.dispatchSlotAction({ slotId: 2, action: 'trigger', frameIndex: 0, nowMs: 0 });
  const pixels = makePixels(2);
  // Advance to after envelope finishes (white_drop: 25+75+300=400ms)
  ctrl.applyMacros({ pixels, frameIndex: 1, nowMs: 500 });
  assert.equal(ctrl.dropHitActive, false);
});

// ── Color wash ──────────────────────────────────────────────────────

test('color wash replace mode pushes pixels toward target color', () => {
  const pixels = [{ r: 0, g: 0, b: 0, w: 0, a: 0, u: 0 }];
  applyColorWash({
    pixels,
    color6: [1, 0, 0, 0, 0, 0],
    amount: 1.0,
    mode: 'replace',
  });
  assert.equal(pixels[0].r, 1);
  assert.equal(pixels[0].g, 0);
});

// ── Hold behaviour ──────────────────────────────────────────────────

test('hold action: down activates strobe, up stops it', () => {
  const ctrl = new GlobalEffectsController({ engine: { fps: 40 } });
  const mgr = new GlobalEffectSlotManager(ctrl);
  // Slot 1 = strobe sync_4hz, default behavior toggle. Override to hold.
  mgr.patchSlot(1, { presetId: 'hard_10hz', behavior: 'hold' });
  mgr.dispatchSlotAction({ slotId: 1, action: 'down', frameIndex: 0, nowMs: 0 });
  assert.equal(ctrl.strobeActive, true);
  mgr.dispatchSlotAction({ slotId: 1, action: 'up', frameIndex: 10, nowMs: 0 });
  assert.equal(ctrl.strobeActive, false);
});

// ── Preset-aware switching ──────────────────────────────────────────

test('toggling a second strobe preset switches config instead of stopping', () => {
  const ctrl = new GlobalEffectsController({ engine: { fps: 40 } });
  const mgr = new GlobalEffectSlotManager(ctrl);
  // Slot 1 (sync_4hz, toggle), then patch slot 5 → strobe pulse_2hz toggle.
  mgr.patchSlot(5, { effectId: 'strobe', presetId: 'pulse_2hz', behavior: 'toggle' });
  mgr.dispatchSlotAction({ slotId: 1, action: 'activate', frameIndex: 0, nowMs: 0 });
  assert.equal(ctrl.strobeActive, true);
  assert.equal(ctrl.activeStrobePresetId, 'sync_4hz');
  mgr.dispatchSlotAction({ slotId: 5, action: 'activate', frameIndex: 5, nowMs: 0 });
  assert.equal(ctrl.strobeActive, true, 'second strobe preset should keep strobe active');
  assert.equal(ctrl.activeStrobePresetId, 'pulse_2hz');
});

test('toggling a second colorWash preset switches without disabling', () => {
  const ctrl = new GlobalEffectsController({ engine: { fps: 40 } });
  const mgr = new GlobalEffectSlotManager(ctrl);
  // Slot 3 = ocean_blue toggle. Patch slot 5 to emergency_red toggle.
  mgr.patchSlot(5, { effectId: 'colorWash', presetId: 'emergency_red', behavior: 'toggle' });
  mgr.dispatchSlotAction({ slotId: 3, action: 'activate', frameIndex: 0, nowMs: 0 });
  assert.equal(ctrl.colorWashConfig.enabled, true);
  assert.equal(ctrl.colorWashConfig.preset, 'ocean_blue');
  mgr.dispatchSlotAction({ slotId: 5, action: 'activate', frameIndex: 0, nowMs: 0 });
  assert.equal(ctrl.colorWashConfig.enabled, true);
  assert.equal(ctrl.colorWashConfig.preset, 'emergency_red');
});

test('toggling same strobe preset twice turns it off', () => {
  const ctrl = new GlobalEffectsController({ engine: { fps: 40 } });
  const mgr = new GlobalEffectSlotManager(ctrl);
  mgr.dispatchSlotAction({ slotId: 1, action: 'toggle', frameIndex: 0, nowMs: 0 });
  assert.equal(ctrl.strobeActive, true);
  mgr.dispatchSlotAction({ slotId: 1, action: 'toggle', frameIndex: 5, nowMs: 0 });
  assert.equal(ctrl.strobeActive, false);
});

// ── Burst / expiry ──────────────────────────────────────────────────

test('slot 6 burst behavior expires after duration frames', () => {
  const ctrl = new GlobalEffectsController({ engine: { fps: 40 } });
  const mgr = new GlobalEffectSlotManager(ctrl);
  mgr.dispatchSlotAction({ slotId: 6, action: 'trigger', frameIndex: 0, nowMs: 0 });
  assert.equal(ctrl.strobeActive, true);
  // 1000ms @ 40fps → 40 frames.
  // Advance loop a few frames, still active.
  const pixels = makePixels(2);
  ctrl.applyMacros({ pixels, frameIndex: 10, nowMs: 250 });
  assert.equal(ctrl.strobeActive, true);
  // Past the burst end: should auto-stop.
  ctrl.applyMacros({ pixels, frameIndex: 60, nowMs: 1500 });
  assert.equal(ctrl.strobeActive, false);
});

test('triggerStrobeBurst clamps durationMs above MAX_BURST_MS', () => {
  const ctrl = new GlobalEffectsController({ engine: { fps: 40 } });
  ctrl.triggerStrobeBurst(10, 9999, 0, {});
  // 2000ms cap → 80 frames @ 40fps.
  assert.equal(ctrl.strobeBurstEndFrame, 80);
});

// ── Feedback trails allocation ──────────────────────────────────────

test('enabling feedback trails allocates buffer; disabling clears it', () => {
  const ctrl = new GlobalEffectsController({ engine: { fps: 40 } });
  const mgr = new GlobalEffectSlotManager(ctrl);
  mgr.dispatchSlotAction({ slotId: 4, action: 'activate', frameIndex: 0, nowMs: 0 });
  assert.equal(ctrl.feedbackTrailsConfig.enabled, true);
  assert.equal(ctrl.feedbackTrailBuffer, null);
  // First applyMacros call allocates the buffer to match pixelCount.
  const pixels = makePixels(8);
  ctrl.applyMacros({ pixels, frameIndex: 0, nowMs: 0 });
  assert.ok(ctrl.feedbackTrailBuffer instanceof Float32Array);
  assert.equal(ctrl.feedbackTrailBuffer.length, 8 * 6);
  // Disable → buffer cleared.
  mgr.dispatchSlotAction({ slotId: 4, action: 'deactivate', frameIndex: 0, nowMs: 0 });
  assert.equal(ctrl.feedbackTrailsConfig.enabled, false);
  assert.equal(ctrl.feedbackTrailBuffer, null);
});

// ── Pipeline ordering ───────────────────────────────────────────────

test('pipeline ordering: colorWash → trails → dropHit → strobe', () => {
  // Verify by ordering side effects: gate=0 strobe MUST blank EVERYTHING
  // applied earlier in the same frame (drop hit, wash, trails).
  const ctrl = new GlobalEffectsController({ engine: { fps: 40 } });
  // Enable everything that would otherwise leave non-zero values.
  ctrl.setColorWash(true, 'emergency_red', 1.0, 'replace');
  ctrl.setFeedbackTrails(true, 'soft_afterimage', { resetOnEnable: true });
  ctrl.triggerDropHit({
    color: [1, 1, 1, 1, 1, 1], intensity: 1.0,
    attackMs: 0, holdMs: 10, releaseMs: 0, blendMode: 'add',
  }, 0);
  // Force a strobe with gate=0 right now: 20Hz burst started at frame
  // 0 (cycle=2, onFrames=1) → frame 1 is OFF.
  ctrl.setStrobe(true, 20, 0.5, 1.0, 0, {});
  const pixels = makePixels(2);
  ctrl.applyMacros({ pixels, frameIndex: 1, nowMs: 5 });
  for (const p of pixels) {
    assert.equal(p.r + p.g + p.b + p.w + p.a + p.u, 0,
      'strobe must run LAST so OFF frame blanks everything earlier in the pipeline');
  }
});

test('drop hit runs after feedback trails (whiteouts do not enter trail history)', () => {
  const ctrl = new GlobalEffectsController({ engine: { fps: 40 } });
  ctrl.setFeedbackTrails(true, 'soft_afterimage', { resetOnEnable: true });
  // Frame 0: pixels start zero, trigger drop hit at peak.
  ctrl.triggerDropHit({
    color: [1, 0, 0, 0, 0, 0], intensity: 1.0,
    attackMs: 0, holdMs: 50, releaseMs: 0, blendMode: 'add',
  }, 0);
  const pixels = makePixels(2);
  for (let i = 0; i < pixels.length; i++) {
    pixels[i].r = 0; pixels[i].g = 0; pixels[i].b = 0;
    pixels[i].w = 0; pixels[i].a = 0; pixels[i].u = 0;
  }
  ctrl.applyMacros({ pixels, frameIndex: 0, nowMs: 0 });
  // After this frame: trail buffer was processed BEFORE drop hit;
  // because frame 0 pixels were 0 going into trails, the buffer
  // should still be ~0 (no drop-hit contamination).
  assert.ok(ctrl.feedbackTrailBuffer[0] < 0.01,
    `trail buffer red channel should be ~0, got ${ctrl.feedbackTrailBuffer[0]}`);
});

// ── Panic stop ──────────────────────────────────────────────────────

test('panic stop clears strobe + drop hits + trails but leaves slots + wash', () => {
  const ctrl = new GlobalEffectsController({ engine: { fps: 40 } });
  const mgr = new GlobalEffectSlotManager(ctrl);
  // Activate all four macro types.
  mgr.dispatchSlotAction({ slotId: 1, action: 'activate', frameIndex: 0, nowMs: 0 }); // strobe
  mgr.dispatchSlotAction({ slotId: 2, action: 'trigger',  frameIndex: 0, nowMs: 0 }); // drop hit
  mgr.dispatchSlotAction({ slotId: 3, action: 'activate', frameIndex: 0, nowMs: 0 }); // wash
  mgr.dispatchSlotAction({ slotId: 4, action: 'activate', frameIndex: 0, nowMs: 0 }); // trails
  const slotsBefore = JSON.stringify(mgr.getSlots());

  ctrl.panicStop();

  assert.equal(ctrl.strobeActive, false);
  assert.equal(ctrl.dropHits.length, 0);
  assert.equal(ctrl.feedbackTrailsConfig.enabled, false);
  // Color wash is intentionally left enabled per §5.3.
  assert.equal(ctrl.colorWashConfig.enabled, true);
  // Slot config unchanged.
  assert.equal(JSON.stringify(mgr.getSlots()), slotsBefore);
});

// ── Status reporting ────────────────────────────────────────────────

test('slot manager getStatus includes active boolean per slot', () => {
  const ctrl = new GlobalEffectsController({ engine: { fps: 40 } });
  const mgr = new GlobalEffectSlotManager(ctrl);
  mgr.dispatchSlotAction({ slotId: 3, action: 'activate', frameIndex: 0, nowMs: 0 });
  const status = mgr.getStatus();
  assert.equal(status.length, 6);
  const slot3 = status.find(s => s.slotId === 3);
  assert.equal(slot3.active, true);
  const slot1 = status.find(s => s.slotId === 1);
  assert.equal(slot1.active, false);
});
