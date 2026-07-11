// Pulse (strobe) Frequency mode — project effects_v2_midi_layout,
// report 20260709_6. Consolidates the five per-Hz strobe presets
// (pulse_2hz…max_20hz) into ONE moded "Pulse" slot: jog-wheel = Flash
// Strength (primaryIntensity), encoder press = Frequency (primaryMode) walking
// 2/4/5/10/20 Hz. These are pure library/manager unit tests — they never spawn
// the engine, a server, or the VSN1 deploy child process.
//
// Run: node --test tests/pulse_frequency_mode.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  GLOBAL_EFFECT_LIBRARY,
  PRIMARY_MODE_REGISTRY,
  PRIMARY_INTENSITY_REGISTRY,
  getPrimaryMode,
  getPrimaryIntensity,
  modeIndexOf,
  nextModeValue,
  normalizeModeDescriptor,
  validateParams,
  map01ToPrimary,
} from '../lib/global_effect_library.js';
import {
  GlobalEffectSlotManager,
  DEFAULT_SLOT_CONFIG,
} from '../lib/global_effect_slot_manager.js';
import { GlobalEffectsController } from '../lib/global_effects_controller.js';
import { strobeEffect } from '../effects/strobe.js';

const PULSE_HZ = [2, 4, 5, 10, 20];
const PULSE_LABELS = ['2 Hz · 1/4', '4 Hz · 1/8', '5 Hz Punch', '10 Hz Hard', '20 Hz Max'];

function mkMgr() {
  const ctrl = new GlobalEffectsController({ engine: { fps: 40 } });
  return { ctrl, mgr: new GlobalEffectSlotManager(ctrl, DEFAULT_SLOT_CONFIG) };
}

// Find (or create) a slot bound to strobe so tests are independent of the
// DEFAULT_SLOT_CONFIG's exact strobe slot ids.
function strobeSlotId(mgr) {
  const s = mgr.getStatus().find((x) => x.effectId === 'strobe' && x.enabled);
  if (s) return s.slotId;
  mgr.patchSlot(1, { enabled: true, label: 'Pulse', effectId: 'strobe', presetId: 'pulse_2hz', behavior: 'toggle' });
  return 1;
}

// ════════════════════════════════════════════════════════════════════
// 1. Presentation: name is "Pulse", not a frequency
// ════════════════════════════════════════════════════════════════════

test('the effect is presented as "Strobe" (frequency dropped from the name)', () => {
  assert.equal(GLOBAL_EFFECT_LIBRARY.strobe.name, 'Strobe');
  assert.ok(!/hz/i.test(GLOBAL_EFFECT_LIBRARY.strobe.name), 'no frequency in the name');
});

// ════════════════════════════════════════════════════════════════════
// 2. primaryMode validates at load + has the exact registry shape
// ════════════════════════════════════════════════════════════════════

test('strobe primaryMode validates at load and appears in the registry', () => {
  const d = PRIMARY_MODE_REGISTRY.strobe;
  assert.ok(d, 'strobe has a non-null primary-mode registry entry');
  assert.equal(d.label, 'Frequency');
  assert.equal(d.param, 'hz');
  assert.deepEqual(d.values, PULSE_HZ);
  assert.equal(d.default, 2, 'sensible musical default = 2 Hz quarter-note pulse');
  assert.ok(d.values.includes(d.default), 'default is a member of values');
  // Frozen (immutable) like every other descriptor.
  assert.ok(Object.isFrozen(d) && Object.isFrozen(d.values));
});

test('primaryMode carries five per-value display labels (LCD/CaptainPad, not M1/M2)', () => {
  const d = getPrimaryMode('strobe');
  assert.ok(Array.isArray(d.valueLabels), 'valueLabels present');
  assert.equal(d.valueLabels.length, d.values.length, 'one label per value');
  assert.deepEqual(d.valueLabels, PULSE_LABELS);
  // None of the labels is a placeholder like "M1"/"Mode 2".
  for (const lbl of d.valueLabels) {
    assert.ok(!/^m\d+$/i.test(lbl) && !/^mode\s*\d+$/i.test(lbl), `label '${lbl}' is meaningful`);
  }
});

test('the strobe module descriptor matches the exact validated shape (mirrors beatPump)', () => {
  // The module-level descriptor round-trips through the validator unchanged.
  const norm = normalizeModeDescriptor('strobe', strobeEffect.primaryMode);
  assert.equal(norm.label, 'Frequency');
  assert.equal(norm.param, 'hz');
  assert.deepEqual(norm.values, PULSE_HZ);
  assert.equal(norm.default, 2);
  assert.deepEqual(norm.valueLabels, PULSE_LABELS);
});

test('valueLabels contract: mismatched length / non-string entries fail LOUD', () => {
  assert.throws(
    () => normalizeModeDescriptor('x', { label: 'F', param: 'hz', values: [2, 4], default: 2, valueLabels: ['only one'] }),
    /valueLabels must be an array of 2/,
  );
  assert.throws(
    () => normalizeModeDescriptor('x', { label: 'F', param: 'hz', values: [2, 4], default: 2, valueLabels: ['a', ''] }),
    /valueLabels must all be non-empty strings/,
  );
  // Absent valueLabels is fine (other effects don't declare them) → null.
  const noLabels = normalizeModeDescriptor('x', { label: 'F', param: 'hz', values: [2, 4], default: 2 });
  assert.equal(noLabels.valueLabels, null);
});

// ════════════════════════════════════════════════════════════════════
// 3. Mode cycle walks ALL FIVE frequencies and writes `hz`
// ════════════════════════════════════════════════════════════════════

test('modeIndexOf / nextModeValue walk the five frequencies and wrap', () => {
  assert.equal(modeIndexOf('strobe', 2), 0);
  assert.equal(modeIndexOf('strobe', 20), 4);
  assert.equal(nextModeValue('strobe', 2), 4);
  assert.equal(nextModeValue('strobe', 4), 5);
  assert.equal(nextModeValue('strobe', 5), 10);
  assert.equal(nextModeValue('strobe', 10), 20);
  assert.equal(nextModeValue('strobe', 20), 2, 'wraps 20 → 2');
  // A stale/absent value resolves to the default's index, not -1.
  assert.equal(modeIndexOf('strobe', 99), modeIndexOf('strobe', 2));
});

test('cycleSlotMode on a Pulse slot walks all 5 Hz in order and writes hz into paramsOverride', () => {
  const { mgr } = mkMgr();
  const id = strobeSlotId(mgr);
  // The current mode starts at the effect default (2 Hz) when untouched.
  assert.equal(mgr.getStatus().find((s) => s.slotId === id).mode, 2);

  const walked = [];
  // Cycle six times so we prove a full lap + the wrap back to 2.
  for (let i = 0; i < 6; i++) {
    const r = mgr.cycleSlotMode(id, {});
    walked.push(r.mode);
    // Every step writes the chosen Hz into the slot's `hz` param override.
    assert.equal(mgr.getSlot(id).paramsOverride.hz, r.mode, `hz override tracks step ${i}`);
    assert.equal(mgr.getSlot(id).mode, r.mode);
  }
  assert.deepEqual(walked, [4, 5, 10, 20, 2, 4], 'walks 2→4→5→10→20→wrap→4');
});

test('setSlotMode to each frequency writes hz + reports the right index', () => {
  const { mgr } = mkMgr();
  const id = strobeSlotId(mgr);
  PULSE_HZ.forEach((hz, i) => {
    const r = mgr.setSlotMode(id, hz, {});
    assert.equal(r.mode, hz);
    assert.equal(r.modeIndex, i);
    assert.equal(mgr.getSlot(id).paramsOverride.hz, hz);
  });
});

test('setSlotMode rejects an off-list frequency (loud, 400 path)', () => {
  const { mgr } = mkMgr();
  const id = strobeSlotId(mgr);
  assert.throws(() => mgr.setSlotMode(id, 7, {}), /not valid for/);
  assert.throws(() => mgr.setSlotMode(id, 60, {}), /not valid for/);
});

// ════════════════════════════════════════════════════════════════════
// 4. Intensity on Pulse is STILL Flash Strength (unchanged)
// ════════════════════════════════════════════════════════════════════

test('primaryIntensity on Pulse is Flash Strength, unchanged (jog-wheel)', () => {
  const d = getPrimaryIntensity('strobe');
  assert.equal(d.label, 'Flash Strength');
  assert.equal(d.param, 'intensity');
  assert.equal(d.default, 1.0);
  assert.equal(d.min, 0);
  assert.equal(d.max, 1);
  // The registry pins the SAME descriptor.
  assert.equal(PRIMARY_INTENSITY_REGISTRY.strobe.label, 'Flash Strength');
  // 0..1 maps linearly onto the intensity param.
  assert.equal(map01ToPrimary('strobe', 0.5), 0.5);
});

test('setSlotIntensity writes `intensity` (flash strength) while mode writes `hz` — independent knobs', () => {
  const { mgr } = mkMgr();
  const id = strobeSlotId(mgr);
  mgr.setSlotIntensity(id, 0.4, {});
  mgr.setSlotMode(id, 10, {});
  const slot = mgr.getSlot(id);
  assert.equal(slot.paramsOverride.intensity, 0.4, 'jog = flash strength');
  assert.equal(slot.paramsOverride.hz, 10, 'encoder press = frequency');
});

// ════════════════════════════════════════════════════════════════════
// 5. Every mode frequency passes the strobe safety validation [1..20]
// ════════════════════════════════════════════════════════════════════

test('every mode frequency passes validateParams strobe safety [1..20]', () => {
  for (const hz of getPrimaryMode('strobe').values) {
    const out = validateParams('strobe', { hz, duty: 0.5, intensity: 1.0 });
    assert.equal(out.hz, hz, `${hz} Hz survives validation`);
    assert.ok(hz >= 1 && hz <= 20, `${hz} in safety range`);
  }
});

test('setSlotMode re-runs safety validation on the hz override (resolveSlotBinding gate)', () => {
  const { mgr } = mkMgr();
  const id = strobeSlotId(mgr);
  // A legit value resolves cleanly through validateParams.
  assert.doesNotThrow(() => mgr.setSlotMode(id, 20, {}));
  // Sanity: the underlying validator still rejects out-of-range hz, so if a
  // future value list ever strayed past 20 the mode write would throw.
  assert.throws(() => validateParams('strobe', { hz: 21 }), /out of safety range/);
  assert.throws(() => validateParams('strobe', { hz: 0.5 }), /out of safety range/);
});

test('mode frequency applies LIVE to a running Pulse (controller strobeConfig.hz updates)', () => {
  const { ctrl, mgr } = mkMgr();
  const id = strobeSlotId(mgr);
  mgr.dispatchSlotAction({ slotId: id, action: 'activate', frameIndex: 0, nowMs: 0 });
  assert.equal(ctrl.strobeActive, true);
  const startHz = ctrl.strobeConfig.hz;
  const r = mgr.setSlotMode(id, startHz === 10 ? 20 : 10, { frameIndex: 1, nowMs: 10 });
  assert.equal(r.applied, true, 're-dispatched live');
  assert.equal(ctrl.strobeConfig.hz, r.mode, 'live strobe rate followed the mode');
});

// ════════════════════════════════════════════════════════════════════
// 6. Backward compatibility — the five preset keys still resolve
// ════════════════════════════════════════════════════════════════════

test('all five legacy preset keys survive and resolve to the right hz (no silent breakage)', () => {
  const presets = GLOBAL_EFFECT_LIBRARY.strobe.presets;
  const expected = { pulse_2hz: 2, sync_4hz: 4, punch_5hz: 5, hard_10hz: 10, max_20hz: 20 };
  for (const [key, hz] of Object.entries(expected)) {
    assert.ok(presets[key], `preset '${key}' still present`);
    assert.equal(presets[key].params.hz, hz, `preset '${key}' → ${hz} Hz`);
  }
  // The preset frequencies are exactly the mode's value set — mode + presets in lockstep.
  const presetHz = Object.values(expected).sort((a, b) => a - b);
  assert.deepEqual(presetHz, [...getPrimaryMode('strobe').values].sort((a, b) => a - b));
});

test('a slot bound to a legacy preset resolves + activates at its documented hz', () => {
  const { ctrl, mgr } = mkMgr();
  mgr.patchSlot(1, { enabled: true, label: 'Punch', effectId: 'strobe', presetId: 'punch_5hz', behavior: 'toggle' });
  mgr.dispatchSlotAction({ slotId: 1, action: 'activate', frameIndex: 0, nowMs: 0 });
  assert.equal(ctrl.activeStrobePresetId, 'punch_5hz');
  assert.equal(ctrl.strobeConfig.hz, 5, 'punch_5hz still fires at 5 Hz');
});

test('backward-compat is achieved by KEEPING keys, so no real reference hits the fallback', () => {
  // The chosen migration is: keep all five preset keys. So every id that could
  // appear in an existing playlist / state file / DEFAULT_SLOT_CONFIG still
  // resolves to a REAL preset — none of them trip resolveSlotBinding's
  // missing-preset path. Prove each resolves without a warning-fallback (the
  // resolved presetId is unchanged, not canonicalized to pulse_2hz).
  for (const key of ['pulse_2hz', 'sync_4hz', 'punch_5hz', 'hard_10hz', 'max_20hz']) {
    const { mgr } = mkMgr();
    mgr.patchSlot(1, { enabled: true, effectId: 'strobe', presetId: key, behavior: 'toggle' });
    const st = mgr.getStatus().find((s) => s.slotId === 1);
    assert.equal(st.presetId, key, `${key} resolves as itself (no silent remap)`);
    assert.equal(st.resolveError, null, `${key} resolves cleanly`);
  }
});

test('a GENUINELY removed strobe preset is loud, not silently wrong (forward-compat fallback)', () => {
  // resolveSlotBinding (slot-manager) canonicalizes an unknown preset to the
  // effect's first declared preset (pulse_2hz) and console.warns so the
  // operator notices — it is NEVER left pointing at a phantom preset. We keep
  // all five real keys, so this only ever fires for a truly-unknown id.
  const { mgr } = mkMgr();
  const warnings = [];
  const orig = console.warn;
  console.warn = (m) => warnings.push(String(m));
  try {
    mgr.patchSlot(1, { enabled: true, effectId: 'strobe', presetId: 'ghost_99hz', behavior: 'toggle' });
    mgr.getStatus();
  } finally {
    console.warn = orig;
  }
  const st = mgr.getStatus().find((s) => s.slotId === 1);
  assert.equal(st.presetId, 'pulse_2hz', 'unknown preset canonicalized to a real one, not left phantom');
  assert.ok(
    warnings.some((w) => /ghost_99hz.*missing/.test(w)),
    'the remap is announced loudly via console.warn',
  );
});
