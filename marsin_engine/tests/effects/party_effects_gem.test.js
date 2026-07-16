// Unit tests for the 7 party effects wired to GEM slots (report 20260708_7).
//
// Covers each new GLOBAL_EFFECT_LIBRARY entry through the FULL slot path:
//   - library registration + primaryIntensity registry entry
//   - activation through a slot (activate / toggle / trigger / down / up)
//   - live intensity write via setSlotIntensity (the A1 re-dispatch path)
//   - deactivate cleanliness (state fully released, no lingering glints)
//   - chain rendering at the documented anchor (preWash / postTrails /
//     postInvert / end) with a real applyMacros/applyPostInvert pass
//   - panicStop policy per effect (kill animation/freeze/overlay; preserve
//     the static-chroma + slow-ambient ops)
//
// Run: node --test tests/party_effects_gem.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  GLOBAL_EFFECT_LIBRARY,
  describeLibrary,
  validateParams,
  getPrimaryIntensity,
  map01ToPrimary,
} from '../../lib/global_effect_library.js';
import {
  GlobalEffectSlotManager,
} from '../../lib/global_effect_slot_manager.js';
import { GlobalEffectsController } from '../../lib/global_effects_controller.js';

function makePixels(n = 4) {
  const out = [];
  for (let i = 0; i < n; i++) {
    out.push({
      r: 0.5, g: 0.4, b: 0.3, w: 0.2, a: 0.1, u: 0.05,
      nx: i / Math.max(1, n - 1), ny: i / Math.max(1, n - 1), nz: 0.5,
    });
  }
  return out;
}

// The 7 effects and the slot each test binds them to (slot 5 is a scratch
// slot in DEFAULT_SLOT_CONFIG we re-bind freely).
const PARTY_EFFECTS = [
  { effectId: 'beatPump',       preset: 'soft',        behavior: 'toggle',  activeFlag: (c) => c.beatPump.enabled },
  { effectId: 'waterlineSweep', preset: 'rising_tide', behavior: 'toggle',  activeFlag: (c) => c.sweep.enabled },
  { effectId: 'kickPunch',      preset: 'punch',       behavior: 'toggle',  activeFlag: (c) => c.kickRouter.enabled },
  { effectId: 'freeze',         preset: 'hold',        behavior: 'toggle',  activeFlag: (c) => c.freeze.active },
  { effectId: 'crush',          preset: 'bold_4',      behavior: 'toggle',  activeFlag: (c) => c.crush.enabled },
  { effectId: 'breath',         preset: 'calm',        behavior: 'toggle',  activeFlag: (c) => c.breath.enabled },
  { effectId: 'sparkle',        preset: 'fizz',        behavior: 'toggle',  activeFlag: (c) => c.sparkle.enabled },
];

function bindSlot5(mgr, effectId, presetId, behavior) {
  mgr.patchSlot(5, { enabled: true, label: effectId, effectId, presetId, behavior });
}

// ── Library registration ─────────────────────────────────────────────

test('all 7 party effects are registered in GLOBAL_EFFECT_LIBRARY', () => {
  for (const { effectId } of PARTY_EFFECTS) {
    assert.ok(GLOBAL_EFFECT_LIBRARY[effectId], `${effectId} must be in the library`);
    assert.ok(GLOBAL_EFFECT_LIBRARY[effectId].presets, `${effectId} must declare presets`);
  }
});

test('describeLibrary serializes all 7 party effects (no fn refs leak)', () => {
  const desc = describeLibrary();
  for (const { effectId } of PARTY_EFFECTS) {
    assert.ok(desc[effectId], `${effectId} in describeLibrary output`);
  }
  const round = JSON.parse(JSON.stringify(desc));
  assert.deepEqual(round, desc);
});

test('every party effect carries a primaryIntensity registry entry', () => {
  for (const { effectId } of PARTY_EFFECTS) {
    const d = getPrimaryIntensity(effectId);
    assert.ok(d && typeof d.param === 'string', `${effectId} must have a primary intensity`);
    assert.ok(d.max > d.min, `${effectId} primary min/max must be ordered`);
  }
});

test('kickPunch declares both trigger and toggle behaviors', () => {
  assert.deepEqual(
    [...GLOBAL_EFFECT_LIBRARY.kickPunch.behaviorTypes].sort(),
    ['toggle', 'trigger'],
  );
});

test('freeze declares toggle + hold behaviors', () => {
  assert.ok(GLOBAL_EFFECT_LIBRARY.freeze.behaviorTypes.includes('toggle'));
  assert.ok(GLOBAL_EFFECT_LIBRARY.freeze.behaviorTypes.includes('hold'));
});

// ── Activation through a slot (per effect) ───────────────────────────

for (const { effectId, preset, behavior, activeFlag } of PARTY_EFFECTS) {
  test(`${effectId}: activate → ON, deactivate → OFF through a slot`, () => {
    const ctrl = new GlobalEffectsController({ engine: { fps: 40 } });
    const mgr = new GlobalEffectSlotManager(ctrl);
    bindSlot5(mgr, effectId, preset, behavior);

    assert.equal(activeFlag(ctrl), false, `${effectId} starts off`);
    mgr.dispatchSlotAction({ slotId: 5, action: 'activate', frameIndex: 0, nowMs: 0 });
    assert.equal(activeFlag(ctrl), true, `${effectId} activates`);
    mgr.dispatchSlotAction({ slotId: 5, action: 'deactivate', frameIndex: 1, nowMs: 0 });
    assert.equal(activeFlag(ctrl), false, `${effectId} deactivates`);
  });

  test(`${effectId}: bare toggle flips on then off`, () => {
    const ctrl = new GlobalEffectsController({ engine: { fps: 40 } });
    const mgr = new GlobalEffectSlotManager(ctrl);
    bindSlot5(mgr, effectId, preset, behavior);
    mgr.dispatchSlotAction({ slotId: 5, action: 'toggle', frameIndex: 0, nowMs: 0 });
    assert.equal(activeFlag(ctrl), true, `${effectId} toggle on`);
    mgr.dispatchSlotAction({ slotId: 5, action: 'toggle', frameIndex: 1, nowMs: 0 });
    assert.equal(activeFlag(ctrl), false, `${effectId} toggle off (same preset)`);
  });

  test(`${effectId}: down/up momentary maps to on/off`, () => {
    const ctrl = new GlobalEffectsController({ engine: { fps: 40 } });
    const mgr = new GlobalEffectSlotManager(ctrl);
    bindSlot5(mgr, effectId, preset, behavior);
    mgr.dispatchSlotAction({ slotId: 5, action: 'down', frameIndex: 0, nowMs: 0 });
    assert.equal(activeFlag(ctrl), true, `${effectId} down → on`);
    mgr.dispatchSlotAction({ slotId: 5, action: 'up', frameIndex: 1, nowMs: 0 });
    assert.equal(activeFlag(ctrl), false, `${effectId} up → off`);
  });
}

// ── Live intensity write per effect (A1 re-dispatch path) ────────────

for (const { effectId, preset, behavior } of PARTY_EFFECTS) {
  test(`${effectId}: setSlotIntensity writes the primary param live`, () => {
    const ctrl = new GlobalEffectsController({ engine: { fps: 40 } });
    const mgr = new GlobalEffectSlotManager(ctrl);
    bindSlot5(mgr, effectId, preset, behavior);
    // Activate first so the re-dispatch path is exercised (applied === true
    // for the running singletons; kickPunch trigger has no live state).
    mgr.dispatchSlotAction({ slotId: 5, action: 'activate', frameIndex: 0, nowMs: 0 });

    const desc = getPrimaryIntensity(effectId);
    const result = mgr.setSlotIntensity(5, 0.5, { frameIndex: 1, nowMs: 10 });
    assert.equal(result.intensity, 0.5);
    const expected = map01ToPrimary(effectId, 0.5);
    assert.ok(Math.abs(result.paramValue - expected) < 1e-9,
      `${effectId} paramValue maps 0.5 onto [${desc.min}..${desc.max}]`);
    // The override is written under the primary param name.
    const slot = mgr.getSlot(5);
    assert.ok(Math.abs(slot.paramsOverride[desc.param] - expected) < 1e-9,
      `${effectId} override[${desc.param}] set`);
    // Status surfaces the touched intensity.
    const st = mgr.getStatus().find(s => s.slotId === 5);
    assert.equal(st.intensity, 0.5);
    assert.equal(st.intensityLabel, desc.label);
  });
}

test('setSlotIntensity on a running toggle effect re-dispatches (applied=true)', () => {
  const ctrl = new GlobalEffectsController({ engine: { fps: 40 } });
  const mgr = new GlobalEffectSlotManager(ctrl);
  bindSlot5(mgr, 'breath', 'calm', 'toggle');
  mgr.dispatchSlotAction({ slotId: 5, action: 'activate', frameIndex: 0, nowMs: 0 });
  const res = mgr.setSlotIntensity(5, 0.5, { frameIndex: 1, nowMs: 10 });
  assert.equal(res.applied, true, 'a running breath re-applies live');
  // depth range is [0..0.6] → 0.5 maps to 0.3.
  assert.ok(Math.abs(ctrl.breath.depth - 0.3) < 1e-9, 'live depth updated on the controller');
});

// ── Chain rendering at the documented anchors ────────────────────────

test('E4 Freeze (preWash): replays the captured frame even as pixels change', () => {
  const ctrl = new GlobalEffectsController({ engine: { fps: 40 } });
  const mgr = new GlobalEffectSlotManager(ctrl);
  bindSlot5(mgr, 'freeze', 'hold', 'toggle');
  const pixels = makePixels(2);
  mgr.dispatchSlotAction({ slotId: 5, action: 'activate', frameIndex: 0, nowMs: 0 });
  // Frame 0 captures 0.5 red.
  ctrl.applyMacros({ pixels, frameIndex: 0, nowMs: 0 });
  // Mutate the live buffer; the freeze must replay the captured value.
  pixels[0].r = 0.0;
  ctrl.applyMacros({ pixels, frameIndex: 1, nowMs: 25 });
  assert.ok(Math.abs(pixels[0].r - 0.5) < 1e-6, 'frozen frame replayed, not the live 0');
});

test('E10 Frost Sparkle (postTrails): glints land in W with a deterministic rng', () => {
  const ctrl = new GlobalEffectsController({ engine: { fps: 40 } });
  const mgr = new GlobalEffectSlotManager(ctrl);
  // Force a deterministic rng so a glint is guaranteed.
  ctrl._sparkleState.rng = () => 0.0;
  bindSlot5(mgr, 'sparkle', 'blizzard', 'toggle'); // high density
  const pixels = makePixels(4);
  const baseW = pixels[0].w;
  mgr.dispatchSlotAction({ slotId: 5, action: 'activate', frameIndex: 0, nowMs: 0 });
  ctrl.applyMacros({ pixels, frameIndex: 0, nowMs: 0 });
  assert.ok(pixels[0].w > baseW, 'sparkle adds energy into px[0].w');
  // R/G/B/A/U untouched by the overlay.
  assert.equal(pixels[0].r, 0.5);
  assert.equal(pixels[0].a, 0.1);
});

test('E6 Palette Crush (postInvert): quantizes RGB via applyPostInvert, W/A/U untouched', () => {
  const ctrl = new GlobalEffectsController({ engine: { fps: 40 } });
  const mgr = new GlobalEffectSlotManager(ctrl);
  bindSlot5(mgr, 'crush', 'hard_2', 'toggle'); // 2 levels, amount 1 → snap to {0,1}
  const pixels = [{ r: 0.4, g: 0.9, b: 0.1, w: 0.2, a: 0.1, u: 0.05 }];
  mgr.dispatchSlotAction({ slotId: 5, action: 'activate', frameIndex: 0, nowMs: 0 });
  // Palette crush runs at postInvert — engine.js calls applyPostInvert after
  // applyInvert. Simulate that call here.
  ctrl.applyMacros({ pixels, frameIndex: 0, nowMs: 0 });
  ctrl.applyPostInvert({ pixels, frameIndex: 0, nowMs: 0 });
  assert.equal(pixels[0].r, 0, '0.4 → nearest of {0,1} = 0');
  assert.equal(pixels[0].g, 1, '0.9 → 1');
  assert.equal(pixels[0].b, 0, '0.1 → 0');
  assert.equal(pixels[0].w, 0.2, 'W untouched by chroma crush');
  assert.equal(pixels[0].a, 0.1, 'A untouched');
  assert.equal(pixels[0].u, 0.05, 'U untouched');
});

test('E9 Ocean Breath (end): scales the rig by the swell at the trough', () => {
  const ctrl = new GlobalEffectsController({ engine: { fps: 40 } });
  const mgr = new GlobalEffectSlotManager(ctrl);
  bindSlot5(mgr, 'breath', 'deep', 'toggle'); // depth 0.5, period 14000
  const pixels = makePixels(1);
  mgr.dispatchSlotAction({ slotId: 5, action: 'activate', frameIndex: 0, nowMs: 0 });
  // nowMs=0 → phase 0 → swell = 1 (cos(0)=1) → b = 1 - depth*1 = 0.5 (trough).
  ctrl.applyMacros({ pixels, frameIndex: 0, nowMs: 0 });
  assert.ok(Math.abs(pixels[0].r - 0.5 * 0.5) < 1e-6, 'red dimmed to b*0.5 at trough');
});

test('E1 Beat Pump (end): dips brightness on the beat', () => {
  const ctrl = new GlobalEffectsController({ engine: { fps: 40 } });
  const mgr = new GlobalEffectSlotManager(ctrl);
  bindSlot5(mgr, 'beatPump', 'deep', 'toggle'); // depth 0.6
  const pixels = makePixels(1);
  mgr.dispatchSlotAction({ slotId: 5, action: 'activate', frameIndex: 0, nowMs: 0 });
  // beatPhase 0 (just hit the beat) → deepest dip: scale = 1 - depth = 0.4.
  ctrl.applyMacros({ pixels, frameIndex: 0, nowMs: 0, signals: { beatPhase: 0 } });
  assert.ok(Math.abs(pixels[0].r - 0.5 * 0.4) < 1e-6, 'red dips to (1-depth)*0.5 on the kick');
});

test('E2 Waterline Sweep (step 1.5): boosts pixels inside the band', () => {
  const ctrl = new GlobalEffectsController({ engine: { fps: 40 } });
  const mgr = new GlobalEffectSlotManager(ctrl);
  bindSlot5(mgr, 'waterlineSweep', 'rising_tide', 'toggle');
  // Head free-runs off nowMs from 0. First frame dt=0 so head stays at 0;
  // pixel at ny=0 is at the band center and should be boosted.
  const pixels = makePixels(3); // ny = 0, 0.5, 1
  mgr.dispatchSlotAction({ slotId: 5, action: 'activate', frameIndex: 0, nowMs: 0 });
  const baseB = pixels[0].b;
  ctrl.applyMacros({ pixels, frameIndex: 0, nowMs: 0 });
  assert.ok(pixels[0].b > baseB, 'pixel at the band head gets a blue boost');
});

test('E3 Kick Punch trigger: fires one dropHit immediately', () => {
  const ctrl = new GlobalEffectsController({ engine: { fps: 40 } });
  const mgr = new GlobalEffectSlotManager(ctrl);
  bindSlot5(mgr, 'kickPunch', 'punch', 'trigger');
  assert.equal(ctrl.dropHitActive, false);
  mgr.dispatchSlotAction({ slotId: 5, action: 'trigger', frameIndex: 0, nowMs: 0 });
  assert.equal(ctrl.dropHitActive, true, 'trigger fires a dropHit');
  assert.equal(ctrl.dropHits.length, 1);
});

test('E3 Kick Punch toggle: arms/disarms the auto router (no immediate fire)', () => {
  const ctrl = new GlobalEffectsController({ engine: { fps: 40 } });
  const mgr = new GlobalEffectSlotManager(ctrl);
  bindSlot5(mgr, 'kickPunch', 'punch', 'toggle');
  mgr.dispatchSlotAction({ slotId: 5, action: 'activate', frameIndex: 0, nowMs: 0 });
  assert.equal(ctrl.kickRouter.enabled, true, 'router armed');
  assert.equal(ctrl.dropHitActive, false, 'arming does NOT fire a hit');
  // With a live kick over threshold the router fires through applyMacros.
  const pixels = makePixels(1);
  ctrl.applyMacros({ pixels, frameIndex: 1, nowMs: 100, signals: { kick: 0.9, dropPulse: 0.9 } });
  assert.equal(ctrl.dropHitActive, true, 'a live kick fires the armed router');
  mgr.dispatchSlotAction({ slotId: 5, action: 'deactivate', frameIndex: 2, nowMs: 200 });
  assert.equal(ctrl.kickRouter.enabled, false, 'router disarmed');
});

// ── Deactivate cleanliness ───────────────────────────────────────────

test('sparkle deactivate clears the live glint field (no lingering glints)', () => {
  const ctrl = new GlobalEffectsController({ engine: { fps: 40 } });
  const mgr = new GlobalEffectSlotManager(ctrl);
  ctrl._sparkleState.rng = () => 0.0;
  bindSlot5(mgr, 'sparkle', 'blizzard', 'toggle');
  const pixels = makePixels(4);
  mgr.dispatchSlotAction({ slotId: 5, action: 'activate', frameIndex: 0, nowMs: 0 });
  ctrl.applyMacros({ pixels, frameIndex: 0, nowMs: 0 });
  assert.ok(ctrl._sparkleState.activeCount > 0, 'glints are live before deactivate');
  mgr.dispatchSlotAction({ slotId: 5, action: 'deactivate', frameIndex: 1, nowMs: 25 });
  assert.equal(ctrl.sparkle.enabled, false);
  assert.equal(ctrl._sparkleState.activeCount, 0, 'field cleared on deactivate');
});

test('freeze deactivate releases capture so the next engage re-captures', () => {
  const ctrl = new GlobalEffectsController({ engine: { fps: 40 } });
  const mgr = new GlobalEffectSlotManager(ctrl);
  bindSlot5(mgr, 'freeze', 'hold', 'toggle');
  const pixels = makePixels(2);
  mgr.dispatchSlotAction({ slotId: 5, action: 'activate', frameIndex: 0, nowMs: 0 });
  ctrl.applyMacros({ pixels, frameIndex: 0, nowMs: 0 });
  assert.equal(ctrl._freezeState.captured, true);
  mgr.dispatchSlotAction({ slotId: 5, action: 'deactivate', frameIndex: 1, nowMs: 25 });
  // A frame while released clears the capture (module early-returns + clears).
  ctrl.applyMacros({ pixels, frameIndex: 2, nowMs: 50 });
  assert.equal(ctrl._freezeState.captured, false, 'capture released');
});

test('deactivating a toggle party effect leaves the running config clean', () => {
  const ctrl = new GlobalEffectsController({ engine: { fps: 40 } });
  const mgr = new GlobalEffectSlotManager(ctrl);
  for (const { effectId, preset } of PARTY_EFFECTS.filter(e => e.effectId !== 'kickPunch')) {
    bindSlot5(mgr, effectId, preset, 'toggle');
    mgr.dispatchSlotAction({ slotId: 5, action: 'activate', frameIndex: 0, nowMs: 0 });
    mgr.dispatchSlotAction({ slotId: 5, action: 'deactivate', frameIndex: 1, nowMs: 25 });
    const st = mgr.getStatus().find(s => s.slotId === 5);
    assert.equal(st.active, false, `${effectId} reports inactive after deactivate`);
  }
});

// ── getStatus active flags track the controller ──────────────────────

test('getStatus active flag tracks each party effect through its slot', () => {
  const ctrl = new GlobalEffectsController({ engine: { fps: 40 } });
  const mgr = new GlobalEffectSlotManager(ctrl);
  for (const { effectId, preset, behavior } of PARTY_EFFECTS) {
    bindSlot5(mgr, effectId, preset, behavior);
    let st = mgr.getStatus().find(s => s.slotId === 5);
    assert.equal(st.active, false, `${effectId} inactive before activate`);
    mgr.dispatchSlotAction({ slotId: 5, action: 'activate', frameIndex: 0, nowMs: 0 });
    st = mgr.getStatus().find(s => s.slotId === 5);
    // kickPunch in toggle behavior arms the router (active); reset for next.
    assert.equal(st.active, true, `${effectId} active after activate`);
    mgr.dispatchSlotAction({ slotId: 5, action: 'deactivate', frameIndex: 1, nowMs: 0 });
  }
});

// ── panicStop policy ─────────────────────────────────────────────────

test('panicStop kills animation/freeze/overlay effects (E1/E2/E3/E4/E10)', () => {
  const ctrl = new GlobalEffectsController({ engine: { fps: 40 } });
  const mgr = new GlobalEffectSlotManager(ctrl);
  ctrl._sparkleState.rng = () => 0.0;
  // Arm all the panic-killable party effects on distinct slots.
  mgr.patchSlot(5,  { enabled: true, label: 'pump',    effectId: 'beatPump',       presetId: 'soft',        behavior: 'toggle' });
  mgr.patchSlot(12, { enabled: true, label: 'sweep',   effectId: 'waterlineSweep', presetId: 'rising_tide', behavior: 'toggle' });
  mgr.patchSlot(13, { enabled: true, label: 'kick',    effectId: 'kickPunch',      presetId: 'punch',       behavior: 'toggle' });
  mgr.patchSlot(14, { enabled: true, label: 'freeze',  effectId: 'freeze',         presetId: 'hold',        behavior: 'toggle' });
  mgr.patchSlot(15, { enabled: true, label: 'sparkle', effectId: 'sparkle',        presetId: 'blizzard',    behavior: 'toggle' });
  for (const id of [5, 12, 13, 14, 15]) {
    mgr.dispatchSlotAction({ slotId: id, action: 'activate', frameIndex: 0, nowMs: 0 });
  }
  const pixels = makePixels(4);
  ctrl.applyMacros({ pixels, frameIndex: 0, nowMs: 0 });

  ctrl.panicStop();

  assert.equal(ctrl.beatPump.enabled, false, 'E1 pump killed');
  assert.equal(ctrl.sweep.enabled, false, 'E2 sweep killed');
  assert.equal(ctrl.kickRouter.enabled, false, 'E3 router disarmed');
  assert.equal(ctrl.freeze.active, false, 'E4 freeze released');
  assert.equal(ctrl.sparkle.enabled, false, 'E10 sparkle disabled');
  assert.equal(ctrl._sparkleState.activeCount, 0, 'E10 glint field cleared');
});

test('panicStop PRESERVES the static-chroma + slow-ambient ops (E6 crush, E9 breath)', () => {
  const ctrl = new GlobalEffectsController({ engine: { fps: 40 } });
  const mgr = new GlobalEffectSlotManager(ctrl);
  mgr.patchSlot(5,  { enabled: true, label: 'crush',  effectId: 'crush',  presetId: 'bold_4', behavior: 'toggle' });
  mgr.patchSlot(12, { enabled: true, label: 'breath', effectId: 'breath', presetId: 'calm',   behavior: 'toggle' });
  mgr.dispatchSlotAction({ slotId: 5,  action: 'activate', frameIndex: 0, nowMs: 0 });
  mgr.dispatchSlotAction({ slotId: 12, action: 'activate', frameIndex: 0, nowMs: 0 });

  ctrl.panicStop();

  assert.equal(ctrl.crush.enabled, true, 'E6 crush preserved (static chroma, like invert)');
  assert.equal(ctrl.breath.enabled, true, 'E9 breath preserved (slow ambient, no flash hazard)');
});

// ── validateParams for the new effects ───────────────────────────────

test('validateParams accepts valid party params and rejects bad ones', () => {
  assert.doesNotThrow(() => validateParams('beatPump', { depth: 0.5, rate: 2, curve: 3 }));
  assert.throws(() => validateParams('beatPump', { depth: 2 }), /out of range/);
  assert.throws(() => validateParams('beatPump', { rate: 0 }), /must be > 0/);

  assert.doesNotThrow(() => validateParams('waterlineSweep', { axis: 'radial', mode: 'darken' }));
  assert.throws(() => validateParams('waterlineSweep', { axis: 'q' }), /must be one of/);
  assert.throws(() => validateParams('waterlineSweep', { sync: 'nope' }), /must be one of/);

  assert.doesNotThrow(() => validateParams('kickPunch', { source: 'kick', threshold: 0.5 }));
  assert.throws(() => validateParams('kickPunch', { source: 'bad' }), /must be one of/);

  assert.throws(() => validateParams('freeze', { holdFadeMs: -1 }), /non-negative/);

  const crushOut = validateParams('crush', { levels: 12, amount: 2 });
  assert.equal(crushOut.levels, 8, 'levels clamped to 8');
  assert.equal(crushOut.amount, 1, 'amount clamped to 1');

  assert.throws(() => validateParams('breath', { periodMs: 0 }), /must be > 0/);
  assert.throws(() => validateParams('breath', { depth: 0.9 }), /out of range/);

  assert.throws(() => validateParams('sparkle', { density: -1 }), /non-negative/);
  assert.throws(() => validateParams('sparkle', { audioDensity: 'yes' }), /must be a boolean/);
});

// ── resetSlotIntensity restores the default ──────────────────────────

test('resetSlotIntensity restores the effect default and re-dispatches live', () => {
  const ctrl = new GlobalEffectsController({ engine: { fps: 40 } });
  const mgr = new GlobalEffectSlotManager(ctrl);
  bindSlot5(mgr, 'sparkle', 'fizz', 'toggle');
  mgr.dispatchSlotAction({ slotId: 5, action: 'activate', frameIndex: 0, nowMs: 0 });
  mgr.setSlotIntensity(5, 1.0, { frameIndex: 1, nowMs: 10 }); // density → 0.2
  assert.ok(Math.abs(ctrl.sparkle.density - 0.2) < 1e-9);
  const res = mgr.resetSlotIntensity(5, { frameIndex: 2, nowMs: 20 });
  // default density is 0.02 → normalized default 0.02/0.2 = 0.1.
  assert.ok(Math.abs(res.intensity - 0.1) < 1e-9);
  const slot = mgr.getSlot(5);
  assert.equal(slot.paramsOverride.density, undefined, 'override cleared on reset');
});
