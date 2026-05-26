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
  // Slots 1..6 are the docs/28 §4.3 originals. Slots 7..10 (May 2026)
  // are the migrated legacy rig-globals. Future expansions land at
  // 11+ so existing operator muscle memory stays valid.
  assert.ok(DEFAULT_SLOT_CONFIG.length >= 6, `default slot config must keep slots 1..6 (got ${DEFAULT_SLOT_CONFIG.length})`);
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
  // Operator review May 2026 #10: hold + burst gestures aren't
  // supported in the UI anymore, so the EXPERT_BURST / HOLD_ONLY
  // tiers were demoted to WARNING. The dot is no longer rendered
  // either — see GEM `safetyDotColor` (removed). The library still
  // surfaces safetyTier strings via /global-effect-library for any
  // future operator-side telemetry.
  assert.equal(desc.strobe.presets.max_20hz.safetyTier, SAFETY_TIERS.WARNING);
  assert.equal(desc.strobe.presets.hard_10hz.safetyTier, SAFETY_TIERS.WARNING);
  // Strobe is toggle-only — hold + burst gone from behaviorTypes.
  assert.deepEqual(desc.strobe.behaviorTypes, ['toggle']);
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

test('validateSlotsConfig rejects empty / too-large arrays + duplicate slotIds', () => {
  assert.throws(() => validateSlotsConfig([]),
    /between/);
  // Too many — current MAX_SLOTS = 16, so 17 must fail.
  const tooMany = [];
  for (let i = 1; i <= 17; i++) {
    tooMany.push({ slotId: i, enabled: false, label: `x${i}`, effectId: 'strobe', presetId: 'sync_4hz', behavior: 'toggle', paramsOverride: {} });
  }
  assert.throws(() => validateSlotsConfig(tooMany), /between/);
  const dup = JSON.parse(JSON.stringify(DEFAULT_SLOT_CONFIG));
  dup[1].slotId = 1;
  assert.throws(() => validateSlotsConfig(dup), /Duplicate slotId/);
});

// ── Behavior contract: strobe is toggle-only ────────────────────────
// (Operator review May 2026 #10 — hold + burst removed from the strobe
// behaviorTypes; the EXPERT_BURST / HOLD_ONLY safety gates were dropped
// from validateSlotsConfig at the same time.)

test('strobe presets all accept toggle behavior (no per-preset safety gate)', () => {
  const cfg = JSON.parse(JSON.stringify(DEFAULT_SLOT_CONFIG));
  cfg[5].behavior = 'toggle';
  assert.doesNotThrow(() => validateSlotsConfig(cfg),
    '20Hz max under toggle should validate (was EXPERT_BURST gated)');
  cfg[0].presetId = 'hard_10hz';
  cfg[0].behavior = 'toggle';
  assert.doesNotThrow(() => validateSlotsConfig(cfg),
    '10Hz hard under toggle should validate (was HOLD_ONLY gated)');
});

test('strobe rejects `hold` behavior (removed from behaviorTypes)', () => {
  const bad = JSON.parse(JSON.stringify(DEFAULT_SLOT_CONFIG));
  bad[0].behavior = 'hold';
  assert.throws(() => validateSlotsConfig(bad),
    /does not support behavior 'hold'/);
});

test('strobe rejects `burst` behavior (removed from behaviorTypes)', () => {
  const bad = JSON.parse(JSON.stringify(DEFAULT_SLOT_CONFIG));
  bad[5].behavior = 'burst';
  assert.throws(() => validateSlotsConfig(bad),
    /does not support behavior 'burst'/);
});

test('slot 6 (max_20hz) accepts toggle dispatch at runtime', () => {
  const ctrl = new GlobalEffectsController({ engine: { fps: 40 } });
  const mgr = new GlobalEffectSlotManager(ctrl);
  // Slot 6 default config is now toggle (was burst).
  assert.doesNotThrow(
    () => mgr.dispatchSlotAction({ slotId: 6, action: 'toggle', frameIndex: 0, nowMs: 0 }),
  );
  assert.equal(ctrl.strobeActive, true);
  mgr.dispatchSlotAction({ slotId: 6, action: 'toggle', frameIndex: 1, nowMs: 0 });
  assert.equal(ctrl.strobeActive, false);
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

// ── Hold removed (operator review May 2026 #10) ─────────────────────

test('patchSlot refuses to bind `hold` behavior on any strobe preset', () => {
  const ctrl = new GlobalEffectsController({ engine: { fps: 40 } });
  const mgr = new GlobalEffectSlotManager(ctrl);
  assert.throws(
    () => mgr.patchSlot(1, { presetId: 'hard_10hz', behavior: 'hold' }),
    /does not support behavior 'hold'/,
  );
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
// Operator review May 2026 #10: the slot dispatcher path is toggle-only
// now. The internal triggerStrobeBurst() still exists for any future
// programmatic caller (autopilot cues, OSC bursts) and the auto-stop
// math is exercised below — it just doesn't get reached from the iPad
// any more.

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
  // Disable → starts fading out.
  mgr.dispatchSlotAction({ slotId: 4, action: 'deactivate', frameIndex: 0, nowMs: 0 });
  assert.equal(ctrl.feedbackTrailsConfig.enabled, false);
  assert.equal(ctrl.feedbackTrailsConfig.fadingOut, true);
  assert.notEqual(ctrl.feedbackTrailBuffer, null);
  // Complete the fade out
  ctrl.applyMacros({ pixels, frameIndex: 40, nowMs: 1000 });
  assert.equal(ctrl.feedbackTrailsConfig.fadingOut, false);
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
  assert.equal(ctrl.strobeFadingOut, false);
  assert.equal(ctrl.dropHits.length, 0);
  assert.equal(ctrl.feedbackTrailsConfig.enabled, false);
  assert.equal(ctrl.feedbackTrailsConfig.fadingOut, false);
  // Color wash is now ALSO killed by panic stop (May 2026): the
  // unified e-stop semantics require one hard "everything off"
  // switch, so the old §5.3 carve-out for color wash was removed.
  assert.equal(ctrl.colorWashConfig.enabled, false);
  assert.equal(ctrl.colorWashConfig.fadingOut, false);
  // Slot config unchanged.
  assert.equal(JSON.stringify(mgr.getSlots()), slotsBefore);
});

// ── Status reporting ────────────────────────────────────────────────

test('slot manager getStatus includes active boolean per slot', () => {
  const ctrl = new GlobalEffectsController({ engine: { fps: 40 } });
  const mgr = new GlobalEffectSlotManager(ctrl);
  mgr.dispatchSlotAction({ slotId: 3, action: 'activate', frameIndex: 0, nowMs: 0 });
  const status = mgr.getStatus();
  // Slot count grew from 6 → 10 in May 2026 when legacy rig-globals
  // were migrated into the GEM grid. Assert the *contract* (length
  // matches DEFAULT_SLOT_CONFIG) instead of the literal old number.
  assert.equal(status.length, DEFAULT_SLOT_CONFIG.length);
  const slot3 = status.find(s => s.slotId === 3);
  assert.equal(slot3.active, true);
  const slot1 = status.find(s => s.slotId === 1);
  assert.equal(slot1.active, false);
});

// ── Smooth Disable Tests ─────────────────────────────────────────────

test('strobe smooth disable transitions output from gating to solid', () => {
  const ctrl = new GlobalEffectsController({ engine: { fps: 40 } });
  // Start strobe: 4Hz (10 frames per cycle, 5 on / 5 off)
  ctrl.setStrobe(true, 4, 0.5, 1.0, 0, { fadeOutMs: 500 });
  assert.equal(ctrl.strobeActive, true);

  const pixels = makePixels(1);
  // Frame 5: gate is OFF, so pixels are gated to 0 normally
  ctrl.applyMacros({ pixels, frameIndex: 5, nowMs: 125 });
  assert.equal(pixels[0].r, 0);

  // Disable strobe at t = 200ms
  ctrl.stopStrobe({ nowMs: 200 });
  assert.equal(ctrl.strobeActive, false);
  assert.equal(ctrl.strobeFadingOut, true);

  // At t = 325ms (125ms elapsed of 500ms fade), blend is 1 - 125/500 = 0.75
  // Frame 15: gate is OFF.
  // scale = (0.0) * 0.75 + 1.0 * (1 - 0.75) = 0.25
  const pixels2 = makePixels(1);
  ctrl.applyMacros({ pixels: pixels2, frameIndex: 15, nowMs: 325 });
  assert.ok(Math.abs(pixels2[0].r - 0.5 * 0.25) < 0.01);

  // At t = 700ms (500ms elapsed), fade completes, strobeConfig cleared
  const pixels3 = makePixels(1);
  ctrl.applyMacros({ pixels: pixels3, frameIndex: 30, nowMs: 700 });
  assert.equal(ctrl.strobeFadingOut, false);
  assert.equal(ctrl.strobeConfig, null);
  // Solid/ungated output (0.5)
  assert.equal(pixels3[0].r, 0.5);
});

test('color wash smooth disable transitions amount to 0', () => {
  const ctrl = new GlobalEffectsController({ engine: { fps: 40 } });
  ctrl.setColorWash(true, 'ocean_blue', 1.0, 'replace');
  assert.equal(ctrl.colorWashConfig.enabled, true);

  const pixels = makePixels(1);
  ctrl.applyMacros({ pixels, frameIndex: 0, nowMs: 0 });
  // Fully replaced to ocean_blue [0.05, 0.20, 1.00, 0.00, 0.00, 0.15]
  assert.ok(Math.abs(pixels[0].r - 0.05) < 0.01);

  // Disable with 1000ms fade
  ctrl.setColorWash(false, null, 0, 'tint', { nowMs: 100 });
  assert.equal(ctrl.colorWashConfig.enabled, false);
  assert.equal(ctrl.colorWashConfig.fadingOut, true);

  // At t = 600ms (500ms elapsed, 50% ratio)
  // amount should be 1.0 * 0.5 = 0.5
  const pixels2 = makePixels(1);
  pixels2[0].r = 0; pixels2[0].g = 0; pixels2[0].b = 0;
  ctrl.applyMacros({ pixels: pixels2, frameIndex: 20, nowMs: 600 });
  // replace mode with amount = 0.5: px = px * 0.5 + color6 * 0.5 = 0 * 0.5 + 0.05 * 0.5 = 0.025
  assert.ok(Math.abs(pixels2[0].r - 0.025) < 0.01);

  // At t = 1100ms (1000ms elapsed), fade out is complete
  const pixels3 = makePixels(1);
  pixels3[0].r = 0.5;
  ctrl.applyMacros({ pixels: pixels3, frameIndex: 40, nowMs: 1100 });
  assert.equal(ctrl.colorWashConfig.fadingOut, false);
  assert.equal(pixels3[0].r, 0.5);
});

test('feedback trails smooth disable stops injection and transitions mix to 0', () => {
  const ctrl = new GlobalEffectsController({ engine: { fps: 40 } });
  ctrl.setFeedbackTrails(true, 'soft_afterimage', { mix: 0.8, injection: 0.5, decay: 0.9, colorBleed: 0 });

  const pixels = makePixels(1);
  pixels[0].r = 1.0;
  // Frame 0: allocate and run trails
  ctrl.applyMacros({ pixels, frameIndex: 0, nowMs: 0 });
  // trail = 0 * 0.9 + 1.0 * 0.5 = 0.5
  // output px = 1.0 + 0.5 * 0.8 = 1.4 (clamped to 1.0)
  assert.equal(ctrl.feedbackTrailBuffer[0], 0.5);

  // Disable with 1000ms fade
  ctrl.setFeedbackTrails(false, null, {}, { nowMs: 100 });
  assert.equal(ctrl.feedbackTrailsConfig.enabled, false);
  assert.equal(ctrl.feedbackTrailsConfig.fadingOut, true);

  // At t = 600ms (500ms elapsed, 50% ratio): mix = 0.8 * 0.5 = 0.4.
  // injection is forced to 0.
  // trail buffer decays: trail = 0.5 * 0.9 = 0.45 (injection was 0)
  // output mix: px = px + trail * mix = 1.0 + 0.45 * 0.4 = 1.18
  const pixels2 = makePixels(1);
  pixels2[0].r = 1.0;
  ctrl.applyMacros({ pixels: pixels2, frameIndex: 20, nowMs: 600 });
  assert.ok(Math.abs(ctrl.feedbackTrailBuffer[0] - 0.45) < 0.01);
  assert.equal(pixels2[0].r, 1.0);

  // At t = 1100ms, completed
  const pixels3 = makePixels(1);
  ctrl.applyMacros({ pixels: pixels3, frameIndex: 40, nowMs: 1100 });
  assert.equal(ctrl.feedbackTrailsConfig.fadingOut, false);
  assert.equal(ctrl.feedbackTrailBuffer, null);
});

test('interrupted fade-out cancels deactivation and restores active state', () => {
  const ctrl = new GlobalEffectsController({ engine: { fps: 40 } });
  ctrl.setColorWash(true, 'ocean_blue', 1.0, 'replace');

  // Disable it
  ctrl.setColorWash(false, null, 0, 'tint', { nowMs: 0 });
  assert.equal(ctrl.colorWashConfig.enabled, false);
  assert.equal(ctrl.colorWashConfig.fadingOut, true);

  // Apply a frame during fade
  const pixels = makePixels(1);
  ctrl.applyMacros({ pixels, frameIndex: 5, nowMs: 200 }); // 200ms elapsed of 1000ms

  // Reactivate it (say, with a different preset or same)
  ctrl.setColorWash(true, 'emergency_red', 1.0, 'replace');
  assert.equal(ctrl.colorWashConfig.enabled, true);
  assert.equal(ctrl.colorWashConfig.fadingOut, false);
});

test('validateParams supports and validates fadeOutMs parameter', () => {
  assert.throws(() => validateParams('strobe', { fadeOutMs: -50 }), /must be a non-negative number/);
  assert.throws(() => validateParams('strobe', { fadeOutMs: 'abc' }), /must be a non-negative number/);
  const out = validateParams('strobe', { fadeOutMs: 250 });
  assert.equal(out.fadeOutMs, 250);
});

