/**
 * Unit tests for the per-effect PRIMARY INTENSITY registry (docs/42 VSN1
 * jog-wheel) and the GEM slot intensity surface.
 *
 * Contract:
 *   - Every GEM-bindable effect declares a primaryIntensity descriptor
 *     ({label,param,default,min,max}) OR an explicit null (no primary).
 *     A MISSING declaration is a loud startup error (registry build throws).
 *   - map01ToPrimary / mapPrimaryTo01 convert normalized 0..1 ↔ real param.
 *   - Slot status carries { intensity, intensityDefault, intensityLabel }.
 *   - setSlotIntensity clamps, validates, writes paramsOverride, records the
 *     0..1 value, and applies LIVE to a running toggle effect.
 *   - resetSlotIntensity restores the default and drops the override.
 *   - An effect with no primary (invert, legacy slams) reports null fields
 *     and rejects setSlotIntensity.
 *
 * Run: node --test tests/global_effect_intensity.test.js
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  GLOBAL_EFFECT_LIBRARY,
  PRIMARY_INTENSITY_REGISTRY,
  getPrimaryIntensity,
  map01ToPrimary,
  mapPrimaryTo01,
  normalizePrimaryDescriptor,
} from '../../lib/global_effect_library.js';
import {
  GlobalEffectSlotManager,
  DEFAULT_SLOT_CONFIG,
} from '../../lib/global_effect_slot_manager.js';
import { GlobalEffectsController } from '../../lib/global_effects_controller.js';

// Effect modules — assert each declares a primary at the source.
import { strobeEffect } from '../../effects/strobe.js';
import { dropHitEffect } from '../../effects/dropHit.js';
import { colorWashEffect } from '../../effects/colorWash.js';
import { feedbackTrailsEffect } from '../../effects/feedbackTrails.js';
import { invertEffect } from '../../effects/invert.js';
import { vintageWhiteEffect } from '../../effects/vintageWhite.js';
import { blastWhiteEffect } from '../../effects/blastWhite.js';
import { uvBlastEffect } from '../../effects/uvBlast.js';
import { foggerEffect } from '../../effects/fogger.js';
import { beatPumpEffect } from '../../effects/e1_beat_pump.js';
import { waterlineSweepEffect } from '../../effects/e2_waterline_sweep.js';
import { kickPunchEffect } from '../../effects/e3_kick_punch.js';
import { freezeFrameEffect } from '../../effects/freeze_frame.js';
import { paletteCrushEffect } from '../../effects/palette_crush.js';
import { oceanBreathEffect } from '../../effects/ocean_breath.js';
import { frostSparkleEffect } from '../../effects/frost_sparkle.js';

// ── Registry: every effect declares a primary (or explicit null) ─────

test('every GEM-library effect appears in the primary-intensity registry', () => {
  for (const id of Object.keys(GLOBAL_EFFECT_LIBRARY)) {
    assert.ok(
      Object.prototype.hasOwnProperty.call(PRIMARY_INTENSITY_REGISTRY, id),
      `library effect '${id}' has no primary-intensity registry entry`
    );
  }
});

test('registry descriptors are well-formed (label/param strings, max>min, default in range)', () => {
  for (const [id, d] of Object.entries(PRIMARY_INTENSITY_REGISTRY)) {
    if (d === null) continue; // explicit "no primary"
    assert.equal(typeof d.label, 'string');
    assert.ok(d.label.length > 0, `${id} label empty`);
    assert.equal(typeof d.param, 'string');
    assert.ok(d.param.length > 0, `${id} param empty`);
    assert.ok(Number.isFinite(d.min) && Number.isFinite(d.max) && d.max > d.min, `${id} bad range`);
    assert.ok(d.default >= d.min && d.default <= d.max, `${id} default out of range`);
  }
});

test('effects with a tunable magnitude declare a real primary; static ones declare null', () => {
  assert.ok(getPrimaryIntensity('strobe'));
  assert.equal(getPrimaryIntensity('strobe').param, 'intensity');
  assert.equal(getPrimaryIntensity('dropHit').param, 'intensity');
  assert.equal(getPrimaryIntensity('colorWash').param, 'amount');
  assert.equal(getPrimaryIntensity('feedbackTrails').param, 'mix');
  // Static / on-off effects: no tunable primary.
  assert.equal(getPrimaryIntensity('invert'), null);
  assert.equal(getPrimaryIntensity('vintageWhite'), null);
  assert.equal(getPrimaryIntensity('blastWhite'), null);
  assert.equal(getPrimaryIntensity('uvBlast'), null);
  assert.equal(getPrimaryIntensity('fogger'), null);
});

test('ALL party effect modules also declare a primary (item 1: every effect MUST declare one)', () => {
  // The party effects are not yet GEM-slot-bound but must still carry a
  // primary so they are jog-wheel-ready when wired.
  const declared = [
    ['e1 beat pump', beatPumpEffect, 'depth'],
    ['e2 waterline sweep', waterlineSweepEffect, 'amount'],
    ['e3 kick punch', kickPunchEffect, 'intensityCeil'],
    ['e4 freeze frame', freezeFrameEffect, 'holdFadeMs'],
    ['e6 palette crush', paletteCrushEffect, 'amount'],
    ['e9 ocean breath', oceanBreathEffect, 'depth'],
    ['e10 frost sparkle', frostSparkleEffect, 'density'],
  ];
  for (const [name, fx, param] of declared) {
    assert.ok(fx.primaryIntensity, `${name} must declare primaryIntensity`);
    assert.equal(fx.primaryIntensity.param, param, `${name} primary param`);
    assert.ok(fx.primaryIntensity.max > fx.primaryIntensity.min, `${name} range`);
  }
  // Library-effect modules likewise carry the field at the source.
  for (const fx of [strobeEffect, dropHitEffect, colorWashEffect, feedbackTrailsEffect]) {
    assert.ok(fx.primaryIntensity && typeof fx.primaryIntensity === 'object');
  }
  for (const fx of [invertEffect, vintageWhiteEffect, blastWhiteEffect, uvBlastEffect, foggerEffect]) {
    assert.equal(fx.primaryIntensity, null);
  }
});

test('getPrimaryIntensity throws on an unknown effectId (no silent fallback)', () => {
  assert.throws(() => getPrimaryIntensity('lightningStrike'), /unknown effectId/);
});

test('a MISSING declaration is a loud error; explicit null is accepted (Codex P0)', () => {
  // undefined (forgot to declare) → throw.
  assert.throws(() => normalizePrimaryDescriptor('newFx', undefined), /missing a primaryIntensity/);
  // explicit null (deliberate "no primary") → passes through as null.
  assert.equal(normalizePrimaryDescriptor('newFx', null), null);
  // Malformed shapes throw.
  assert.throws(() => normalizePrimaryDescriptor('x', { param: 'p', default: 0, min: 0, max: 1 }), /label/);
  assert.throws(() => normalizePrimaryDescriptor('x', { label: 'L', default: 0, min: 0, max: 1 }), /param/);
  assert.throws(() => normalizePrimaryDescriptor('x', { label: 'L', param: 'p', default: 0, min: 1, max: 0 }), /max>min/);
  assert.throws(() => normalizePrimaryDescriptor('x', { label: 'L', param: 'p', default: 5, min: 0, max: 1 }), /out of/);
});

// ── Mapping math ─────────────────────────────────────────────────────

test('map01ToPrimary maps [0,1] onto [min,max] and clamps out-of-range input', () => {
  // colorWash amount range is [0,1] → identity.
  assert.equal(map01ToPrimary('colorWash', 0), 0);
  assert.equal(map01ToPrimary('colorWash', 1), 1);
  assert.equal(map01ToPrimary('colorWash', 0.5), 0.5);
  // Out-of-range clamps.
  assert.equal(map01ToPrimary('colorWash', -0.5), 0);
  assert.equal(map01ToPrimary('colorWash', 2), 1);
});

test('a non-[0,1] primary range maps normalized 0..1 onto real units (freeze holdFadeMs)', () => {
  // freeze_frame is not GEM-slot-bound (not in the library registry), so its
  // descriptor is validated at the module level. A 0..1 knob spans 0..10000 ms.
  const d = freezeFrameEffect.primaryIntensity;
  assert.equal(d.param, 'holdFadeMs');
  assert.equal(d.min, 0);
  assert.equal(d.max, 10000);
  // Linear map: 0→0, 0.5→5000, 1→10000.
  assert.equal(d.min + (d.max - d.min) * 0.5, 5000);
});

test('mapPrimaryTo01 is the inverse of map01ToPrimary', () => {
  for (const v of [0, 0.25, 0.5, 0.75, 1]) {
    const real = map01ToPrimary('feedbackTrails', v);
    assert.ok(Math.abs(mapPrimaryTo01('feedbackTrails', real) - v) < 1e-9);
  }
});

test('mapping throws for an effect with no primary', () => {
  assert.throws(() => map01ToPrimary('invert', 0.5), /no primary intensity/);
  assert.throws(() => mapPrimaryTo01('invert', 0.5), /no primary intensity/);
});

// ── Slot status intensity fields ─────────────────────────────────────

test('slot status carries intensity / intensityDefault / intensityLabel', () => {
  const ctrl = new GlobalEffectsController({ engine: { fps: 40 } });
  const mgr = new GlobalEffectSlotManager(ctrl);
  const status = mgr.getStatus();
  // Slot 3 = colorWash (default amount 0.7, range [0,1] → default 0.7 norm).
  const s3 = status.find(s => s.slotId === 3);
  assert.equal(s3.effectId, 'colorWash');
  assert.equal(s3.intensityLabel, 'Wash Depth');
  assert.equal(s3.intensityDefault, 0.7);
  assert.equal(s3.intensity, 0.7); // untouched → default
  // Slot 9 = invert → no primary → all null.
  const s9 = status.find(s => s.slotId === 9);
  assert.equal(s9.effectId, 'invert');
  assert.equal(s9.intensity, null);
  assert.equal(s9.intensityDefault, null);
  assert.equal(s9.intensityLabel, null);
});

test('untouched slot reports the DEFAULT even when a preset param differs', () => {
  // Slot 1 = strobe sync_4hz, default intensity 1.0.
  const ctrl = new GlobalEffectsController({ engine: { fps: 40 } });
  const mgr = new GlobalEffectSlotManager(ctrl);
  const s1 = mgr.getStatus().find(s => s.slotId === 1);
  assert.equal(s1.intensityLabel, 'Flash Strength');
  assert.equal(s1.intensity, 1.0);
  assert.equal(s1.intensityDefault, 1.0);
});

// ── setSlotIntensity ─────────────────────────────────────────────────

test('setSlotIntensity writes the mapped param into paramsOverride + records 0..1', () => {
  const ctrl = new GlobalEffectsController({ engine: { fps: 40 } });
  const mgr = new GlobalEffectSlotManager(ctrl);
  const r = mgr.setSlotIntensity(3, 0.25, { frameIndex: 0, nowMs: 0 });
  assert.equal(r.intensity, 0.25);
  assert.equal(r.paramValue, 0.25); // colorWash amount range [0,1]
  const slot = mgr.getSlot(3);
  assert.equal(slot.intensity, 0.25);
  assert.equal(slot.paramsOverride.amount, 0.25);
  // Status reflects it.
  assert.equal(mgr.getStatus().find(s => s.slotId === 3).intensity, 0.25);
});

test('setSlotIntensity clamps out-of-range values', () => {
  const ctrl = new GlobalEffectsController({ engine: { fps: 40 } });
  const mgr = new GlobalEffectSlotManager(ctrl);
  assert.equal(mgr.setSlotIntensity(3, 5, {}).intensity, 1);
  assert.equal(mgr.setSlotIntensity(3, -2, {}).intensity, 0);
});

test('setSlotIntensity rejects garbage values (400 path)', () => {
  const ctrl = new GlobalEffectsController({ engine: { fps: 40 } });
  const mgr = new GlobalEffectSlotManager(ctrl);
  assert.throws(() => mgr.setSlotIntensity(3, NaN, {}), /finite number/);
  assert.throws(() => mgr.setSlotIntensity(3, 'loud', {}), /finite number/);
  assert.throws(() => mgr.setSlotIntensity(3, undefined, {}), /finite number/);
});

test('setSlotIntensity rejects an effect with no primary', () => {
  const ctrl = new GlobalEffectsController({ engine: { fps: 40 } });
  const mgr = new GlobalEffectSlotManager(ctrl);
  assert.throws(() => mgr.setSlotIntensity(9, 0.5, {}), /no primary intensity/); // invert
});

test('setSlotIntensity rejects an unknown slotId', () => {
  const ctrl = new GlobalEffectsController({ engine: { fps: 40 } });
  const mgr = new GlobalEffectSlotManager(ctrl);
  assert.throws(() => mgr.setSlotIntensity(999, 0.5, {}), /Invalid slotId/);
});

// ── LIVE application ─────────────────────────────────────────────────

test('setSlotIntensity applies LIVE to a running colorWash', () => {
  const ctrl = new GlobalEffectsController({ engine: { fps: 40 } });
  const mgr = new GlobalEffectSlotManager(ctrl);
  mgr.dispatchSlotAction({ slotId: 3, action: 'activate', frameIndex: 0, nowMs: 0 });
  assert.equal(ctrl.colorWashConfig.amount, 0.7); // preset default at activate
  const r = mgr.setSlotIntensity(3, 0.2, { frameIndex: 0, nowMs: 10 });
  assert.equal(r.applied, true);
  assert.equal(ctrl.colorWashConfig.amount, 0.2); // re-dispatched live
});

test('setSlotIntensity applies LIVE to a running strobe (intensity flows to config)', () => {
  const ctrl = new GlobalEffectsController({ engine: { fps: 40 } });
  const mgr = new GlobalEffectSlotManager(ctrl);
  mgr.dispatchSlotAction({ slotId: 1, action: 'activate', frameIndex: 0, nowMs: 0 });
  assert.equal(ctrl.strobeConfig.intensity, 1.0);
  const r = mgr.setSlotIntensity(1, 0.5, { frameIndex: 5, nowMs: 100 });
  assert.equal(r.applied, true);
  assert.equal(ctrl.strobeConfig.intensity, 0.5);
});

test('setSlotIntensity on an INACTIVE slot does not re-dispatch (applied=false) but persists', () => {
  const ctrl = new GlobalEffectsController({ engine: { fps: 40 } });
  const mgr = new GlobalEffectSlotManager(ctrl);
  const r = mgr.setSlotIntensity(3, 0.4, { frameIndex: 0, nowMs: 0 });
  assert.equal(r.applied, false);
  assert.equal(ctrl.colorWashConfig.enabled, false); // never turned on
  assert.equal(mgr.getSlot(3).paramsOverride.amount, 0.4); // still persisted
});

test('dropHit (trigger) intensity persists but does NOT auto-fire on set', () => {
  const ctrl = new GlobalEffectsController({ engine: { fps: 40 } });
  const mgr = new GlobalEffectSlotManager(ctrl);
  // Fire one so dropHitActive is true, then change intensity.
  mgr.dispatchSlotAction({ slotId: 2, action: 'trigger', frameIndex: 0, nowMs: 0 });
  const before = ctrl.dropHits.length;
  const r = mgr.setSlotIntensity(2, 0.3, { frameIndex: 0, nowMs: 10 });
  assert.equal(r.applied, false); // trigger effects are not re-dispatched
  assert.equal(ctrl.dropHits.length, before); // no spurious extra hit
  assert.equal(mgr.getSlot(2).paramsOverride.intensity, 0.3);
});

// ── resetSlotIntensity ───────────────────────────────────────────────

test('resetSlotIntensity restores the default and drops the override', () => {
  const ctrl = new GlobalEffectsController({ engine: { fps: 40 } });
  const mgr = new GlobalEffectSlotManager(ctrl);
  mgr.setSlotIntensity(3, 0.1, {});
  assert.equal(mgr.getSlot(3).paramsOverride.amount, 0.1);
  const r = mgr.resetSlotIntensity(3, {});
  assert.equal(r.intensity, 0.7); // colorWash default
  assert.equal(mgr.getSlot(3).intensity, null);
  assert.equal(Object.prototype.hasOwnProperty.call(mgr.getSlot(3).paramsOverride, 'amount'), false);
  assert.equal(mgr.getStatus().find(s => s.slotId === 3).intensity, 0.7);
});

test('resetSlotIntensity applies LIVE to a running effect', () => {
  const ctrl = new GlobalEffectsController({ engine: { fps: 40 } });
  const mgr = new GlobalEffectSlotManager(ctrl);
  mgr.dispatchSlotAction({ slotId: 3, action: 'activate', frameIndex: 0, nowMs: 0 });
  mgr.setSlotIntensity(3, 0.2, { frameIndex: 0, nowMs: 10 });
  assert.equal(ctrl.colorWashConfig.amount, 0.2);
  const r = mgr.resetSlotIntensity(3, { frameIndex: 0, nowMs: 20 });
  assert.equal(r.applied, true);
  assert.equal(ctrl.colorWashConfig.amount, 0.7); // back to preset default
});

test('resetSlotIntensity rejects an effect with no primary', () => {
  const ctrl = new GlobalEffectsController({ engine: { fps: 40 } });
  const mgr = new GlobalEffectSlotManager(ctrl);
  assert.throws(() => mgr.resetSlotIntensity(9, {}), /no primary intensity/); // invert
});

// ── Persistence + effect swap ────────────────────────────────────────

test('intensity survives the getSlots/setSlots round-trip (persistence)', () => {
  const ctrl = new GlobalEffectsController({ engine: { fps: 40 } });
  const mgr = new GlobalEffectSlotManager(ctrl);
  mgr.setSlotIntensity(3, 0.33, {});
  const saved = mgr.getSlots();
  const mgr2 = new GlobalEffectSlotManager(ctrl, saved);
  assert.equal(mgr2.getSlot(3).intensity, 0.33);
  assert.equal(mgr2.getSlot(3).paramsOverride.amount, 0.33);
  assert.equal(mgr2.getStatus().find(s => s.slotId === 3).intensity, 0.33);
});

test('swapping a slot effect via patchSlot drops the stale touched intensity', () => {
  const ctrl = new GlobalEffectsController({ engine: { fps: 40 } });
  const mgr = new GlobalEffectSlotManager(ctrl);
  mgr.setSlotIntensity(3, 0.9, {}); // colorWash amount=0.9
  // Swap slot 3 to feedbackTrails: the old touched intensity must not carry.
  mgr.patchSlot(3, { effectId: 'feedbackTrails', presetId: 'ghost_ship' });
  assert.equal(mgr.getSlot(3).intensity, null);
  // Status now reports the feedbackTrails default (mix 0.5 → 0.5 norm).
  const s3 = mgr.getStatus().find(s => s.slotId === 3);
  assert.equal(s3.intensityLabel, 'Trail Mix');
  assert.equal(s3.intensity, 0.5);
});

// ── DEFAULT_SLOT_CONFIG sanity ───────────────────────────────────────

test('no DEFAULT_SLOT_CONFIG slot has an intensity that would break status', () => {
  const ctrl = new GlobalEffectsController({ engine: { fps: 40 } });
  const mgr = new GlobalEffectSlotManager(ctrl, DEFAULT_SLOT_CONFIG);
  for (const s of mgr.getStatus()) {
    // Either a numeric 0..1 pair or all-null; never a mismatch.
    if (s.intensityLabel === null) {
      assert.equal(s.intensity, null);
      assert.equal(s.intensityDefault, null);
    } else {
      assert.ok(s.intensity >= 0 && s.intensity <= 1);
      assert.ok(s.intensityDefault >= 0 && s.intensityDefault <= 1);
    }
  }
});
