// Multi-instance Color Wash (RCA 2026-07-13).
// Run:  node --test tests/color_wash_multi_instance.test.js
//
// ROOT CAUSE: "Ocean Wash" (colorWash/ocean_blue, slot 3) and "Emergency Red"
// (colorWash/emergency_red, slot 8) were two PRESETS of the SAME `colorWash`
// singleton, which owned ONE runtime wash layer. Activating either preset
// REPLACED the other's layer, so turning on Emergency Red turned off Ocean
// Wash — even though preset-aware ACTIVE reporting made the pads LOOK
// independent. FIX: colorWash is now keyed per slot (`slot:${slotId}`), with a
// slotless key (`sched:${presetId}`) for scheduler / direct dispatch. Two
// washes composite in the same frame; each fades out independently.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { GlobalEffectsController } from '../lib/global_effects_controller.js';
import { GlobalEffectSlotManager } from '../lib/global_effect_slot_manager.js';

function makePixels(n = 3) {
  const out = [];
  for (let i = 0; i < n; i++) out.push({ r: 0, g: 0, b: 0, w: 0, a: 0, u: 0 });
  return out;
}

function mk() {
  const ctrl = new GlobalEffectsController({ engine: { fps: 40 } });
  const mgr = new GlobalEffectSlotManager(ctrl);
  // Slot 8 defaults to Blast Wht — re-bind it to the Emergency Red wash so we
  // reproduce the exact reported slot-3 + slot-8 pairing.
  mgr.patchSlot(8, {
    enabled: true, label: 'Emergency Red', effectId: 'colorWash',
    presetId: 'emergency_red', behavior: 'toggle',
  });
  return { ctrl, mgr };
}

const active = (mgr, slotId) => mgr.getStatus().find(s => s.slotId === slotId).active;

// ── 1. Two washes coexist + BOTH composite into the frame ────────────────

test('activate ocean (slot 3) THEN emergency (slot 8): BOTH active, no replace', () => {
  const { ctrl, mgr } = mk();
  mgr.dispatchSlotAction({ slotId: 3, action: 'activate', frameIndex: 0, nowMs: 0 });
  assert.equal(ctrl.colorWashes.size, 1);
  mgr.dispatchSlotAction({ slotId: 8, action: 'activate', frameIndex: 0, nowMs: 0 });
  assert.equal(ctrl.colorWashes.size, 2, 'emergency did NOT replace ocean');
  assert.equal(active(mgr, 3), true, 'ocean still reports active');
  assert.equal(active(mgr, 8), true, 'emergency also reports active');
});

test('both washes composite into the same frame (pre-fix: only the last survived)', () => {
  const ctrl = new GlobalEffectsController({ engine: { fps: 40 } });
  // Drive the controller directly with 'max' blend so each wash contributes a
  // distinct channel — a clean discriminator: ocean lifts BLUE, emergency lifts
  // RED. If only one layer survived (the bug), one of these would stay 0.
  ctrl.setColorWash(true, 'ocean_blue', 1.0, 'max', { slotId: 3 });   // color b=1.0
  ctrl.setColorWash(true, 'emergency_red', 1.0, 'max', { slotId: 8 }); // color r=1.0
  const pixels = makePixels(1);
  ctrl.applyMacros({ pixels, frameIndex: 0, nowMs: 0 });
  assert.ok(pixels[0].b > 0.99, `ocean blue must survive (b=${pixels[0].b})`);
  assert.ok(pixels[0].r > 0.99, `emergency red must survive (r=${pixels[0].r})`);
});

// ── 2. Independent deactivate + independent fadeOut ──────────────────────

test('deactivate slot 3 leaves slot 8 active AND rendering; fades are independent', () => {
  const { ctrl, mgr } = mk();
  mgr.dispatchSlotAction({ slotId: 3, action: 'activate', frameIndex: 0, nowMs: 0 });
  mgr.dispatchSlotAction({ slotId: 8, action: 'activate', frameIndex: 0, nowMs: 0 });

  // Deactivate ONLY slot 3 → it fades; slot 8 untouched.
  mgr.dispatchSlotAction({ slotId: 3, action: 'deactivate', frameIndex: 1, nowMs: 100 });
  assert.equal(ctrl.colorWashes.get('slot:3').fadingOut, true, 'slot 3 fading');
  assert.equal(ctrl.colorWashes.get('slot:8').enabled, true, 'slot 8 still enabled');
  assert.equal(ctrl.colorWashes.get('slot:8').fadingOut, false);
  assert.equal(active(mgr, 8), true, 'slot 8 stays active');

  // Slot 8 (emergency_red, replace, amount 0.9) still paints the frame.
  const pixels = makePixels(1);
  ctrl.applyMacros({ pixels, frameIndex: 2, nowMs: 150 });
  assert.ok(pixels[0].r > 0.5, `slot 8 must still render (r=${pixels[0].r})`);

  // Let slot 3's fade (started 100ms, 1000ms default) complete — only slot 3 is
  // removed; slot 8 remains.
  ctrl.applyMacros({ pixels: makePixels(1), frameIndex: 3, nowMs: 2000 });
  assert.equal(ctrl.colorWashes.has('slot:3'), false, 'slot 3 fully faded out + removed');
  assert.equal(ctrl.colorWashes.has('slot:8'), true, 'slot 8 unaffected by slot 3 fade');
});

// ── 3. Same-slot toggle twice → off (single-wash regression) ─────────────

test('same-slot toggle twice turns that wash off', () => {
  const { ctrl, mgr } = mk();
  mgr.dispatchSlotAction({ slotId: 3, action: 'toggle', frameIndex: 0, nowMs: 0 });
  assert.equal(active(mgr, 3), true);
  mgr.dispatchSlotAction({ slotId: 3, action: 'toggle', frameIndex: 1, nowMs: 10 });
  assert.equal(active(mgr, 3), false, 'second toggle turns it off');
  // Fade completes → entry gone.
  ctrl.applyMacros({ pixels: makePixels(1), frameIndex: 2, nowMs: 5000 });
  assert.equal(ctrl.colorWashes.has('slot:3'), false);
});

// ── 4. Live mode-cycle re-applies to ONLY that wash (in-place fast path) ──

test('mode-cycle on one active wash mutates ONLY that entry, in place', () => {
  const { ctrl, mgr } = mk();
  mgr.dispatchSlotAction({ slotId: 3, action: 'activate', frameIndex: 0, nowMs: 0 });
  mgr.dispatchSlotAction({ slotId: 8, action: 'activate', frameIndex: 0, nowMs: 0 });
  const e3 = ctrl.colorWashes.get('slot:3');
  const e8 = ctrl.colorWashes.get('slot:8');
  const e8ModeBefore = e8.mode;

  mgr.setSlotMode(3, 'replace', { frameIndex: 1, nowMs: 10 });

  // Same entry object (in-place, no glitchy rebuild), mode applied live.
  assert.equal(ctrl.colorWashes.get('slot:3'), e3, 'slot 3 entry identity preserved');
  assert.equal(e3.mode, 'replace', 'slot 3 blend applied live');
  // Slot 8 wholly untouched.
  assert.equal(ctrl.colorWashes.get('slot:8'), e8, 'slot 8 entry untouched');
  assert.equal(e8.mode, e8ModeBefore, 'slot 8 blend unchanged');
});

// ── 5. disableAll turns both off; panic/blackout clears both immediately ──

test('disableAll turns both washes off (bindings kept); panic clears immediately', () => {
  const { ctrl, mgr } = mk();
  mgr.dispatchSlotAction({ slotId: 3, action: 'activate', frameIndex: 0, nowMs: 0 });
  mgr.dispatchSlotAction({ slotId: 8, action: 'activate', frameIndex: 0, nowMs: 0 });
  const res = mgr.disableAll({ frameIndex: 1, nowMs: 100 });
  assert.ok(res.disabled.includes(3) && res.disabled.includes(8));
  assert.equal(active(mgr, 3), false);
  assert.equal(active(mgr, 8), false);

  // Re-activate then panic → both entries dropped instantly (no fade tail).
  mgr.dispatchSlotAction({ slotId: 3, action: 'activate', frameIndex: 2, nowMs: 200 });
  mgr.dispatchSlotAction({ slotId: 8, action: 'activate', frameIndex: 2, nowMs: 200 });
  assert.equal(ctrl.colorWashes.size, 2);
  ctrl.panicStop();
  assert.equal(ctrl.colorWashes.size, 0, 'panic clears every wash immediately');
  assert.equal(ctrl.colorWashConfig.enabled, false);
});

// ── 6. Slotless scheduler dispatch coexists + disables only itself ───────

test('slotless scheduler wash coexists with a slot wash and disables only itself', () => {
  const { ctrl, mgr } = mk();
  mgr.dispatchSlotAction({ slotId: 3, action: 'activate', frameIndex: 0, nowMs: 0 }); // slot:3
  mgr.dispatchEffectAction({
    effectId: 'colorWash', presetId: 'emergency_red', action: 'activate',
    frameIndex: 0, nowMs: 0,
  }); // sched:emergency_red (slotId null)
  assert.equal(ctrl.colorWashes.size, 2);
  assert.ok(ctrl.colorWashes.has('slot:3'));
  assert.ok(ctrl.colorWashes.has('sched:emergency_red'));

  // Deactivate the scheduler wash only.
  mgr.dispatchEffectAction({
    effectId: 'colorWash', presetId: 'emergency_red', action: 'deactivate',
    frameIndex: 1, nowMs: 100,
  });
  assert.equal(ctrl.colorWashes.get('slot:3').enabled, true, 'slot wash untouched');
  const sched = ctrl.colorWashes.get('sched:emergency_red');
  assert.equal(sched.fadingOut, true, 'scheduler wash fades');
  assert.equal(sched.enabled, false);
});

// ── 7. Cross-effect independence unchanged; strobe stays a single instance ─

test('strobe is still a single instance (activating a 2nd preset switches, not coexists)', () => {
  // Contrast guard: colorWash went multi-instance; strobe/feedbackTrails keep
  // their genuinely-exclusive single-instance semantics (one gate / one buffer).
  const { ctrl, mgr } = mk();
  mgr.dispatchSlotAction({ slotId: 1, action: 'activate', frameIndex: 0, nowMs: 0 }); // sync_4hz
  assert.equal(ctrl.strobeActive, true);
  assert.equal(ctrl.activeStrobePresetId, 'sync_4hz');
  mgr.dispatchSlotAction({ slotId: 6, action: 'activate', frameIndex: 1, nowMs: 0 }); // max_20hz
  assert.equal(ctrl.strobeActive, true, 'still one strobe');
  assert.equal(ctrl.activeStrobePresetId, 'max_20hz', 'switched in place — not two strobes');
});
