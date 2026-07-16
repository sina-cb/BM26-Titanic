// Effects v2 engine track (project effects_v2_midi_layout) — unit tests for
// the 32-slot paging, the primaryMode registry + slot mode surface, the
// engine-owned layout model + layout-changed deploy hook, and the sync surface
// (status carries page/intensity/mode).
//
// These are pure library/manager unit tests — they NEVER spawn the engine, a
// server, or the VSN1 deploy child process (the deploy hook is mocked). API-
// level sync + persistence is covered by effects_v2_api.test.js.
//
// Run: node --test tests/effects_v2_mode_page_layout.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  GLOBAL_EFFECT_LIBRARY,
  PRIMARY_MODE_REGISTRY,
  getPrimaryMode,
  modeIndexOf,
  nextModeValue,
  normalizeModeDescriptor,
} from '../../lib/global_effect_library.js';
import {
  GlobalEffectSlotManager,
  DEFAULT_SLOT_CONFIG,
  MAX_SLOTS,
  MIN_PAGE,
  MAX_PAGE,
  PAGE_COUNT,
  SLOTS_PER_PAGE,
  pageSlotRange,
  pageOfSlot,
} from '../../lib/global_effect_slot_manager.js';
import { GlobalEffectsController } from '../../lib/global_effects_controller.js';
import { createLayoutDeployHook, isLayoutDeployEnabled } from '../../lib/vsn1_layout_deploy.js';

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import yaml from 'js-yaml';

function mkMgr(opts) {
  const ctrl = new GlobalEffectsController({ engine: { fps: 40 } });
  return new GlobalEffectSlotManager(ctrl, DEFAULT_SLOT_CONFIG, opts);
}

// ════════════════════════════════════════════════════════════════════
// Task 3 — primaryMode registry (mirrors primaryIntensity)
// ════════════════════════════════════════════════════════════════════

test('every GEM-library effect appears in the primary-mode registry', () => {
  for (const id of Object.keys(GLOBAL_EFFECT_LIBRARY)) {
    assert.ok(
      Object.prototype.hasOwnProperty.call(PRIMARY_MODE_REGISTRY, id),
      `library effect '${id}' has no primary-mode registry entry`
    );
  }
});

test('mode descriptors are well-formed (label/param strings, >=2 values, default in values)', () => {
  for (const [id, d] of Object.entries(PRIMARY_MODE_REGISTRY)) {
    if (d === null) continue; // explicit "no mode"
    assert.equal(typeof d.label, 'string');
    assert.ok(d.label.length > 0, `${id} label empty`);
    assert.equal(typeof d.param, 'string');
    assert.ok(d.param.length > 0, `${id} param empty`);
    assert.ok(Array.isArray(d.values) && d.values.length >= 2, `${id} needs >=2 values`);
    assert.ok(d.values.some(v => v === d.default), `${id} default not in values`);
  }
});

test('effects with a discrete mode declare one; static ones declare null', () => {
  // Wired multi-mode effects.
  assert.equal(getPrimaryMode('beatPump').param, 'rate');
  assert.deepEqual(getPrimaryMode('beatPump').values, [0.5, 1, 2]);
  assert.equal(getPrimaryMode('waterlineSweep').param, 'sync');
  assert.equal(getPrimaryMode('kickPunch').param, 'source');
  assert.equal(getPrimaryMode('crush').param, 'levels');
  assert.equal(getPrimaryMode('breath').param, 'periodMs');
  assert.equal(getPrimaryMode('sparkle').param, 'audioDensity');
  assert.deepEqual(getPrimaryMode('sparkle').values, [false, true]); // boolean = 2-value list
  assert.equal(getPrimaryMode('colorWash').param, 'mode');
  // Pulse (strobe) now has a Frequency mode (consolidated the old per-Hz presets).
  assert.equal(getPrimaryMode('strobe').param, 'hz');
  assert.deepEqual(getPrimaryMode('strobe').values, [2, 4, 5, 10, 20]);
  // Static / no-second-control effects: explicit null.
  assert.equal(getPrimaryMode('invert'), null);
  assert.equal(getPrimaryMode('vintageWhite'), null);
  assert.equal(getPrimaryMode('fogger'), null);
});

test('getPrimaryMode throws on an unknown effectId (no silent fallback)', () => {
  assert.throws(() => getPrimaryMode('lightningStrike'), /unknown effectId/);
});

test('a MISSING mode declaration is a loud error; explicit null is accepted (Codex P0)', () => {
  assert.throws(() => normalizeModeDescriptor('newFx', undefined), /missing a primaryMode/);
  assert.equal(normalizeModeDescriptor('newFx', null), null);
  assert.throws(() => normalizeModeDescriptor('x', { param: 'p', values: [1, 2], default: 1 }), /label/);
  assert.throws(() => normalizeModeDescriptor('x', { label: 'L', values: [1, 2], default: 1 }), /param/);
  assert.throws(() => normalizeModeDescriptor('x', { label: 'L', param: 'p', values: [1], default: 1 }), />= 2/);
  assert.throws(() => normalizeModeDescriptor('x', { label: 'L', param: 'p', values: [1, 2], default: 9 }), /not in values/);
});

test('modeIndexOf / nextModeValue cycle and wrap', () => {
  assert.equal(modeIndexOf('beatPump', 1), 1);
  assert.equal(nextModeValue('beatPump', 0.5), 1);
  assert.equal(nextModeValue('beatPump', 1), 2);
  assert.equal(nextModeValue('beatPump', 2), 0.5); // wrap
  // Stale/absent value resolves to the default's index, not -1.
  assert.equal(modeIndexOf('beatPump', 99), modeIndexOf('beatPump', 1));
  assert.equal(nextModeValue('sparkle', false), true);
  assert.equal(nextModeValue('sparkle', true), false);
});

// ════════════════════════════════════════════════════════════════════
// Task 2 — 32 slots + paging geometry + engine-owned effectsPage
// ════════════════════════════════════════════════════════════════════

test('MAX_SLOTS is 32, 4 pages of 8', () => {
  assert.equal(MAX_SLOTS, 32);
  assert.equal(SLOTS_PER_PAGE, 8);
  assert.equal(PAGE_COUNT, 4);
  assert.equal(MIN_PAGE, 0);
  assert.equal(MAX_PAGE, 3);
});

test('pageSlotRange views 8p+1..8p+8; pageOfSlot inverts it', () => {
  assert.deepEqual(pageSlotRange(0), { firstSlotId: 1, lastSlotId: 8 });
  assert.deepEqual(pageSlotRange(1), { firstSlotId: 9, lastSlotId: 16 });
  assert.deepEqual(pageSlotRange(3), { firstSlotId: 25, lastSlotId: 32 });
  assert.equal(pageOfSlot(1), 0);
  assert.equal(pageOfSlot(8), 0);
  assert.equal(pageOfSlot(9), 1);
  assert.equal(pageOfSlot(32), 3);
  assert.throws(() => pageSlotRange(4), /page must be an integer/);
  assert.throws(() => pageSlotRange(-1), /page must be an integer/);
});

test('slots 17..32 are now assignable via patchSlot (were rejected at 16)', () => {
  const mgr = mkMgr();
  const slot = mgr.patchSlot(32, { enabled: true, label: 'p3 last', effectId: 'crush', presetId: 'bold_4', behavior: 'toggle' });
  assert.equal(slot.slotId, 32);
  assert.equal(slot.effectId, 'crush');
  const st = mgr.getStatus().find(s => s.slotId === 32);
  assert.equal(st.page, 3, 'slot 32 falls on page 3');
});

test('effectsPage is engine-owned, defaults to 0, validated on set', () => {
  const mgr = mkMgr();
  assert.equal(mgr.getEffectsPage(), 0);
  assert.equal(mgr.setEffectsPage(2), 2);
  assert.equal(mgr.getEffectsPage(), 2);
  assert.deepEqual(mgr.currentPageRange(), { firstSlotId: 17, lastSlotId: 24 });
  assert.throws(() => mgr.setEffectsPage(4), /effectsPage must be an integer/);
  assert.throws(() => mgr.setEffectsPage(1.5), /effectsPage must be an integer/);
  assert.throws(() => mgr.setEffectsPage('2'), /effectsPage must be an integer/);
});

test('paging is a pure VIEW — it does not touch slot bindings or fire a layout deploy', () => {
  let deploys = 0;
  const mgr = mkMgr({ onLayoutChanged: () => { deploys += 1; } });
  const slotsBefore = mgr.getSlots();
  mgr.setEffectsPage(3);
  mgr.setEffectsPage(0);
  assert.deepEqual(mgr.getSlots(), slotsBefore, 'slot bindings unchanged by paging');
  assert.equal(deploys, 0, 'paging never triggers a layout deploy');
});

// ── deploy-on-load: requestFullDeploy() re-emits the CURRENT layout ──────
// The engine boot path + POST /global-effects/deploy use this to sync the
// VSN1 to the current layout without an edit ("update the UI with the
// layout" for LOAD). It is NOT a mutation — it re-emits the populated pages.

test('populatedPages lists only pages that hold a populated slot', () => {
  const mgr = mkMgr();
  const base = mgr.populatedPages();
  assert.ok(base.includes(0), 'defaults populate page 0');
  assert.ok(!base.includes(3), 'page 3 is empty by default');
  mgr.patchSlot(32, { enabled: true, label: 'p3', effectId: 'crush', presetId: 'bold_4', behavior: 'toggle' });
  assert.ok(mgr.populatedPages().includes(3), 'page 3 populated after assigning slot 32');
});

test('requestFullDeploy emits ONLY page 0 (own-page retirement), never pages 1-3', () => {
  const events = [];
  const mgr = mkMgr({ onLayoutChanged: (evt) => events.push(evt) });
  // Populate page 3 too — but the device is a fixed page-0 surface, so a full
  // re-sync must STILL only emit page 0 (kills the multi-page boot flash burst).
  mgr.patchSlot(32, { enabled: true, label: 'p3', effectId: 'crush', presetId: 'bold_4', behavior: 'toggle' });
  assert.ok(mgr.populatedPages().includes(0) && mgr.populatedPages().includes(3),
    'both pages 0 and 3 are populated');
  const before = events.length;
  const pages = mgr.requestFullDeploy();
  assert.deepEqual(pages, [0], 'returns page 0 ONLY, even though page 3 is populated');
  assert.equal(events.length, before + 1, 'emits exactly one layout-changed');
  const last = events[events.length - 1];
  assert.deepEqual(last.pages, [0], 'event carries page 0 only');
  assert.ok(last.layout && Array.isArray(last.layout.slots), 'event carries the current layout');
});

test('requestFullDeploy emits nothing when page 0 is NOT populated', () => {
  const events = [];
  const mgr = mkMgr({ onLayoutChanged: (evt) => events.push(evt) });
  // Clear every page-0 slot (1..8); populate only page 3.
  for (let id = 1; id <= 8; id++) mgr.patchSlot(id, { enabled: false, effectId: null });
  mgr.patchSlot(32, { enabled: true, label: 'p3', effectId: 'crush', presetId: 'bold_4', behavior: 'toggle' });
  const before = events.length;
  const pages = mgr.requestFullDeploy();
  assert.deepEqual(pages, [], 'no page 0 content → nothing to flash on the page-0 device');
  assert.equal(events.length, before, 'no layout-changed emitted');
});

test('requestFullDeploy is a safe no-op (returns []) when no deploy hook is wired', () => {
  const mgr = mkMgr(); // boot/tests without a hook must never emit or throw
  assert.deepEqual(mgr.requestFullDeploy(), []);
});

// ── named BANKS (engine-owned active-bank selector) ──────────────────────
//
// The bank-manager UNIT contract (fresh=1 edit bank, setActiveBank swap +
// fail-loud on unknown id, nextBank cycle/wrap/no-op) is owned by
// global_effect_banks.test.js. What is UNIQUE here — and stays — is how a bank
// switch interacts with the layout DEPLOY hook (mode_page's domain).

test('switching the active bank is not a slot mutation and fires no layout deploy', () => {
  let deploys = 0;
  const mgr = mkMgr({ onLayoutChanged: () => { deploys += 1; } });
  const slotsBefore = mgr.getSlots();
  mgr.createBank();
  mgr.setActiveBank('bank_1');
  mgr.setActiveBank('edit');
  assert.deepEqual(mgr.getSlots(), slotsBefore, 'slot bindings unchanged by a bank switch');
  assert.equal(deploys, 0, 'a bank switch never emits layout-changed by itself');
});

test('the API bank-switch flow (swap + requestFullDeploy) fires exactly one page-0 deploy', async () => {
  // Model the api_server handler: setActiveBank (no emit) THEN requestFullDeploy
  // (emits page 0 iff populated). Wire a real ENABLED deploy hook with an
  // injected fake spawn so we can count device flashes. The target bank is
  // seeded with the default (page-0-populated) config so the re-flash fires.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vsn1-bank-deploy-'));
  const calls = [];
  const { hook, flush } = createLayoutDeployHook({
    stateDir: dir,
    engineConfig: { vsn1: { deployLayout: true } },
    spawnFn: mkFakeSpawn(calls),
  });
  const mgr = mkMgr({ onLayoutChanged: (evt) => { hook(evt); } });
  // A second bank that ALSO has page-0 content (clone of the default config).
  mgr.setBanks([
    { id: 'edit', name: 'Edit', slots: mgr.getSlots() },
    { id: 'play', name: 'Play', slots: mgr.getSlots() },
  ], 'edit');

  mgr.setActiveBank('play');            // swap only — no emit
  const pages = mgr.requestFullDeploy(); // re-flash the new bank (page 0)
  assert.deepEqual(pages, [0], 'requestFullDeploy emits page 0 (bank is populated there)');
  await flush();
  assert.equal(calls.length, 1, 'exactly one page-0 deploy for the bank switch');
  assert.equal(calls[0].args[calls[0].args.indexOf('--page') + 1], '0', 'deploys ONLY page 0');
});

// ════════════════════════════════════════════════════════════════════
// Task 3 — slot mode surface (set / cycle / status / live apply / swap)
// ════════════════════════════════════════════════════════════════════

test('status carries mode / modeValues / modeLabel / modeIndex; null when no mode', () => {
  const mgr = mkMgr();
  // Slot 3 = colorWash → mode 'tint' default (Blend).
  const s3 = mgr.getStatus().find(s => s.slotId === 3);
  assert.equal(s3.modeLabel, 'Blend');
  assert.deepEqual(s3.modeValues, ['tint', 'replace', 'multiply', 'max']);
  assert.equal(s3.mode, 'tint');
  assert.equal(s3.modeIndex, 0);
  // Slot 9 = invert → no mode → all null.
  const s9 = mgr.getStatus().find(s => s.slotId === 9);
  assert.equal(s9.mode, null);
  assert.equal(s9.modeValues, null);
  assert.equal(s9.modeLabel, null);
  assert.equal(s9.modeIndex, null);
});

test('setSlotMode writes the mode param into paramsOverride + records the value', () => {
  const mgr = mkMgr();
  const r = mgr.setSlotMode(3, 'replace', {});
  assert.equal(r.mode, 'replace');
  assert.equal(r.modeIndex, 1);
  const slot = mgr.getSlot(3);
  assert.equal(slot.mode, 'replace');
  assert.equal(slot.paramsOverride.mode, 'replace');
  assert.equal(mgr.getStatus().find(s => s.slotId === 3).mode, 'replace');
});

test('setSlotMode rejects a value outside the effect list (loud, 400 path)', () => {
  const mgr = mkMgr();
  assert.throws(() => mgr.setSlotMode(3, 'plaid', {}), /not valid for/);
});

test('setSlotMode / cycleSlotMode reject a slot/effect with no mode', () => {
  const mgr = mkMgr();
  assert.throws(() => mgr.setSlotMode(9, 'x', {}), /no primary mode/); // invert
  assert.throws(() => mgr.cycleSlotMode(9, {}), /no primary mode/);
});

test('cycleSlotMode steps to the next value and wraps', () => {
  const mgr = mkMgr();
  // Bind slot 5 to beatPump (rate modes 0.5,1,2 — default 1).
  mgr.patchSlot(5, { enabled: true, label: 'pump', effectId: 'beatPump', presetId: 'soft', behavior: 'toggle' });
  assert.equal(mgr.getStatus().find(s => s.slotId === 5).mode, 1); // default
  assert.equal(mgr.cycleSlotMode(5, {}).mode, 2);
  assert.equal(mgr.cycleSlotMode(5, {}).mode, 0.5); // wrap
  assert.equal(mgr.cycleSlotMode(5, {}).mode, 1);
});

test('setSlotMode applies LIVE to a running effect (colorWash blend mode)', () => {
  const ctrl = new GlobalEffectsController({ engine: { fps: 40 } });
  const mgr = new GlobalEffectSlotManager(ctrl, DEFAULT_SLOT_CONFIG);
  mgr.dispatchSlotAction({ slotId: 3, action: 'activate', frameIndex: 0, nowMs: 0 });
  assert.equal(ctrl.colorWashConfig.mode, 'tint'); // preset default at activate
  const r = mgr.setSlotMode(3, 'replace', { frameIndex: 1, nowMs: 10 });
  assert.equal(r.applied, true);
  assert.equal(ctrl.colorWashConfig.mode, 'replace', 're-dispatched live');
});

test('cycleSlotMode on a running party effect applies live (beatPump rate)', () => {
  const ctrl = new GlobalEffectsController({ engine: { fps: 40 } });
  const mgr = new GlobalEffectSlotManager(ctrl, DEFAULT_SLOT_CONFIG);
  mgr.patchSlot(5, { enabled: true, label: 'pump', effectId: 'beatPump', presetId: 'soft', behavior: 'toggle' });
  mgr.dispatchSlotAction({ slotId: 5, action: 'activate', frameIndex: 0, nowMs: 0 });
  assert.equal(ctrl.beatPump.rate, 1);
  const r = mgr.cycleSlotMode(5, { frameIndex: 1, nowMs: 10 }); // → 2
  assert.equal(r.applied, true);
  assert.equal(ctrl.beatPump.rate, 2, 'live rate updated on the controller');
});

test('mode survives the getSlots/setSlots round-trip (persistence)', () => {
  const ctrl = new GlobalEffectsController({ engine: { fps: 40 } });
  const mgr = new GlobalEffectSlotManager(ctrl, DEFAULT_SLOT_CONFIG);
  mgr.setSlotMode(3, 'multiply', {});
  const saved = mgr.getSlots();
  const mgr2 = new GlobalEffectSlotManager(ctrl, saved);
  assert.equal(mgr2.getSlot(3).mode, 'multiply');
  assert.equal(mgr2.getStatus().find(s => s.slotId === 3).mode, 'multiply');
});

test('swapping a slot effect drops the stale touched mode + its override param', () => {
  const mgr = mkMgr();
  mgr.setSlotMode(3, 'replace', {}); // colorWash mode
  mgr.patchSlot(3, { effectId: 'feedbackTrails', presetId: 'ghost_ship' });
  const slot = mgr.getSlot(3);
  assert.equal(slot.mode, null, 'touched mode dropped on swap');
  assert.equal(slot.paramsOverride.mode, undefined, 'stale colorWash mode override cleared');
  // New effect reports ITS default mode (feedbackTrails Blend → 'add').
  const st = mgr.getStatus().find(s => s.slotId === 3);
  assert.equal(st.modeLabel, 'Blend');
  assert.equal(st.mode, 'add');
});

test('a mode change is RUNTIME FEEDBACK — it never fires a layout deploy', () => {
  let deploys = 0;
  const mgr = mkMgr({ onLayoutChanged: () => { deploys += 1; } });
  mgr.setSlotMode(3, 'replace', {});
  mgr.cycleSlotMode(3, {});
  mgr.setSlotIntensity(3, 0.5, {});
  assert.equal(deploys, 0, 'value/mode changes are not layout changes');
});

// ════════════════════════════════════════════════════════════════════
// Task 4 — layout model + layout-changed event + deploy hook
// ════════════════════════════════════════════════════════════════════

test('getLayout serializes populated slots (id, page, effect, name, color); JSON round-trips', () => {
  const mgr = mkMgr();
  mgr.patchSlot(3, { label: 'Ocean', color: '#0af' });
  const layout = mgr.getLayout();
  assert.equal(layout.version, 1);
  assert.equal(layout.slotsPerPage, 8);
  const s3 = layout.slots.find(s => s.slotId === 3);
  assert.equal(s3.effectId, 'colorWash');
  assert.equal(s3.name, 'Ocean');
  assert.equal(s3.color, '#0af');
  assert.equal(s3.page, 0);
  // No fn refs leak.
  assert.deepEqual(JSON.parse(JSON.stringify(layout)), layout);
  // Disabled/empty slots are omitted.
  mgr.patchSlot(3, { enabled: false });
  assert.equal(mgr.getLayout().slots.find(s => s.slotId === 3), undefined);
});

test('a LAYOUT change (assign/rename/recolor/enable) fires the hook with the serialized layout', () => {
  const events = [];
  const mgr = mkMgr({ onLayoutChanged: (evt) => events.push(evt) });
  mgr.patchSlot(20, { enabled: true, label: 'New', effectId: 'sparkle', presetId: 'fizz', behavior: 'toggle', color: '#fff' });
  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'layout-changed');
  assert.equal(events[0].revision, 1);
  assert.ok(events[0].layout.slots.find(s => s.slotId === 20 && s.effectId === 'sparkle'));
  // A rename is a layout change too.
  mgr.patchSlot(20, { label: 'Renamed' });
  assert.equal(events.length, 2);
  assert.equal(events[1].revision, 2);
  // A recolor is a layout change.
  mgr.patchSlot(20, { color: '#123' });
  assert.equal(events.length, 3);
});

test('ADDING an effect to a slot fires layout-changed with just that slot\'s page', () => {
  const events = [];
  const mgr = mkMgr({ onLayoutChanged: (evt) => events.push(evt) });
  // Slot 20 is on page 2 (pageOfSlot(20) = 2).
  mgr.patchSlot(20, { enabled: true, effectId: 'sparkle', presetId: 'fizz', behavior: 'toggle' });
  assert.equal(events.length, 1);
  assert.deepEqual(events[0].pages, [2], 'only slot 20\'s page (2) is deployed');
  assert.equal(pageOfSlot(20), 2);
});

test('REMOVING an effect from a slot (clear / disable) fires layout-changed on that page', () => {
  const events = [];
  const mgr = mkMgr({ onLayoutChanged: (evt) => events.push(evt) });
  // Slot 3 (page 0) starts populated in DEFAULT_SLOT_CONFIG. Disable it (remove).
  mgr.patchSlot(3, { enabled: false });
  assert.equal(events.length, 1);
  assert.deepEqual(events[0].pages, [0], 'disabling slot 3 deploys page 0');
  // Clearing the binding (disable + null effect) is also a removal on that page;
  // the slot goes dark on the device. Slot 11 → page 1.
  mgr.patchSlot(11, { enabled: false, effectId: null });
  assert.equal(events.length, 2);
  assert.deepEqual(events[1].pages, [1]);
  assert.equal(pageOfSlot(11), 1);
});

test('a whole-config replace marks ALL pages for deploy', () => {
  const events = [];
  const mgr = mkMgr({ onLayoutChanged: (evt) => events.push(evt) });
  mgr.setSlots(mgr.getSlots(), { emitLayout: true });
  assert.equal(events.length, 1);
  assert.deepEqual(events[0].pages, [0, 1, 2, 3], 'a config replace can touch every page');
});

test('value/mode/intensity changes fire NO layout event (no pages, no deploy)', () => {
  const events = [];
  const mgr = mkMgr({ onLayoutChanged: (evt) => events.push(evt) });
  mgr.setSlotIntensity(3, 0.5, {});
  mgr.setSlotMode(3, 'replace', {});
  mgr.cycleSlotMode(3, {});
  mgr.setEffectsPage(2); // paging is a pure view
  assert.equal(events.length, 0, 'runtime feedback + paging never emit layout-changed');
});

test('setSlots(emitLayout:true) fires a layout deploy; the default does not', () => {
  const events = [];
  const mgr = mkMgr({ onLayoutChanged: (evt) => events.push(evt) });
  const cfg = mgr.getSlots();
  mgr.setSlots(cfg); // boot-style restore → no deploy
  assert.equal(events.length, 0);
  mgr.setSlots(cfg, { emitLayout: true }); // API PATCH → deploy
  assert.equal(events.length, 1);
});

test('construction and boot-restore do NOT fire a deploy', () => {
  let deploys = 0;
  // Passing the hook at construction must not fire during setSlots-in-ctor.
  const ctrl = new GlobalEffectsController({ engine: { fps: 40 } });
  new GlobalEffectSlotManager(ctrl, DEFAULT_SLOT_CONFIG, { onLayoutChanged: () => { deploys += 1; } });
  assert.equal(deploys, 0);
});

// ── deploy hook (mocked spawn — never launches a real process) ────────

// A fake child_process that reports the given exit code (default 0) on its
// next tick, echoing `stderr` bytes first. Records every invocation into
// `calls`. Never touches a real port.
function mkFakeSpawn(calls, { code = 0, stderr = '' } = {}) {
  return (cmd, args) => {
    calls.push({ cmd, args });
    return {
      stdout: { on: () => {} },
      stderr: { on: (ev, cb) => { if (ev === 'data' && stderr) cb(Buffer.from(stderr)); } },
      on: (ev, cb) => { if (ev === 'close') setImmediate(() => cb(code)); },
    };
  };
}

// A controllable fake timer: armDebounce/clear go through here so tests fire
// the quiet period deterministically. `fire()` runs the pending callback now.
function mkFakeTimer() {
  const state = { cb: null };
  return {
    setTimeoutFn: (cb) => { state.cb = cb; return state; },
    clearTimeoutFn: () => { state.cb = null; },
    fire: () => { const c = state.cb; state.cb = null; if (c) c(); },
    armed: () => state.cb !== null,
  };
}

const layoutEvt = (pages, revision = 1) => ({
  type: 'layout-changed', revision, pages,
  layout: { version: 1, slots: [{ slotId: 1, effectId: 'strobe' }] },
});

test('deploy hook is DISABLED by default: writes layout JSON but does not spawn', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vsn1-deploy-'));
  let spawned = 0;
  const { hook, status, flush } = createLayoutDeployHook({
    stateDir: dir,
    engineConfig: {}, // no vsn1.deployLayout
    spawnFn: () => { spawned += 1; throw new Error('should not spawn'); },
  });
  assert.equal(status.enabled, false);
  const res = await hook({ type: 'layout-changed', revision: 1, pages: [0], layout: { version: 1, slots: [{ slotId: 1, effectId: 'strobe' }] } });
  assert.equal(res.deployed, false);
  assert.equal(res.reason, 'disabled');
  await flush(); // even after a forced flush, nothing spawns when disabled
  assert.equal(spawned, 0, 'no child process spawned when disabled');
  // The layout YAML IS written for tools/operator inspection (v3 switched the
  // artifact from vsn1_layout.json to vsn1_layout.yaml).
  const written = yaml.load(fs.readFileSync(path.join(dir, 'vsn1_layout.yaml'), 'utf8'));
  assert.equal(written.slots[0].effectId, 'strobe');
  assert.ok(!fs.existsSync(path.join(dir, 'vsn1_layout.json')), 'no stale JSON artifact');
  assert.equal(status.lastResult, 'disabled');
});

test('deploy hook ENABLED deploys the pinned single-page CLI contract and reports ok', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vsn1-deploy2-'));
  const calls = [];
  const { hook, status, flush } = createLayoutDeployHook({
    stateDir: dir,
    engineConfig: { vsn1: { deployLayout: true } },
    spawnFn: mkFakeSpawn(calls),
  });
  assert.equal(status.enabled, true);
  // A page-0 change coalesces + debounces; flush() forces the deploy. (Page 0 is
  // the only page the device shows — own-page retirement.)
  const res = await hook({ type: 'layout-changed', revision: 7, pages: [0], layout: { version: 1, slots: [] } });
  assert.equal(res.deployed, false);
  assert.equal(res.reason, 'debounced');
  await flush();
  assert.equal(calls.length, 1, 'one page → one CLI call');
  assert.equal(calls[0].cmd, 'node');
  // Pinned single-page contract:
  //   node tools/vsn1_config/deploy_layout.cjs --from-engine --page N --live
  const a = calls[0].args;
  assert.ok(a.some(x => x.endsWith(path.join('tools', 'vsn1_config', 'deploy_layout.cjs'))));
  assert.ok(a.includes('--from-engine'));
  assert.equal(a[a.indexOf('--page') + 1], '0', 'deploys ONLY page 0');
  assert.ok(a.includes('--live'));
  assert.equal(status.lastResult, 'ok');
  assert.equal(status.lastRevision, 7);
  assert.deepEqual(status.lastPages, [0]);
});

test('deploy is a SINGLE page-0 flash even for a multi-page change (own-page retirement)', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vsn1-inc-'));
  const calls = [];
  const { hook, flush } = createLayoutDeployHook({
    stateDir: dir,
    engineConfig: { vsn1: { deployLayout: true } },
    spawnFn: mkFakeSpawn(calls),
  });
  // A whole-config replace touching pages 0 and 3 — only page 0 reaches COM12.
  await hook(layoutEvt([0, 3], 1));
  await flush();
  const pagesFlashed = calls.map(c => c.args[c.args.indexOf('--page') + 1]);
  assert.deepEqual(pagesFlashed, ['0'], 'only page 0, never page 3');
  assert.equal(calls.length, 1, 'never a multi-page flash burst');
});

test('DEBOUNCE: a burst of page-0 edits coalesces into ONE deploy', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vsn1-debounce-'));
  const calls = [];
  const timer = mkFakeTimer();
  const { hook, flush } = createLayoutDeployHook({
    stateDir: dir,
    engineConfig: { vsn1: { deployLayout: true } },
    spawnFn: mkFakeSpawn(calls),
    setTimeoutFn: timer.setTimeoutFn,
    clearTimeoutFn: timer.clearTimeoutFn,
  });
  // Five rapid edits on page 0 (reassigning several slots on the visible page).
  for (let i = 0; i < 5; i++) await hook(layoutEvt([0], i + 1));
  assert.equal(calls.length, 0, 'nothing deploys during the quiet period');
  assert.ok(timer.armed(), 'debounce timer is armed');
  timer.fire();          // quiet period elapses
  await flush();
  assert.equal(calls.length, 1, 'a burst on page 0 = exactly ONE deploy');
  assert.equal(calls[0].args[calls[0].args.indexOf('--page') + 1], '0');
});

test('DEBOUNCE: edits spanning pages 0-2 during the window collapse to ONE page-0 deploy', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vsn1-debounce2-'));
  const calls = [];
  const timer = mkFakeTimer();
  const { hook, flush } = createLayoutDeployHook({
    stateDir: dir,
    engineConfig: { vsn1: { deployLayout: true } },
    spawnFn: mkFakeSpawn(calls),
    setTimeoutFn: timer.setTimeoutFn,
    clearTimeoutFn: timer.clearTimeoutFn,
  });
  await hook(layoutEvt([0], 1));
  await hook(layoutEvt([1], 2)); // invisible — dropped
  await hook(layoutEvt([2], 3)); // invisible — dropped
  timer.fire();
  await flush();
  const pages = calls.map(c => c.args[c.args.indexOf('--page') + 1]);
  assert.deepEqual(pages, ['0'], 'only page 0 flashes; the invisible-page edits are dropped');
});

test('BUSY-GUARD: overlapping changes never open COM12 twice — deploys serialize', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vsn1-busy-'));
  // A spawn that stays "running" until we release it, so we can prove no two
  // children are alive at once.
  let alive = 0;
  let maxAlive = 0;
  const releases = [];
  const calls = [];
  const gatedSpawn = (cmd, args) => {
    calls.push({ cmd, args });
    alive += 1; maxAlive = Math.max(maxAlive, alive);
    let closeCb = null;
    releases.push(() => { alive -= 1; if (closeCb) closeCb(0); });
    return {
      stdout: { on: () => {} },
      stderr: { on: () => {} },
      on: (ev, cb) => { if (ev === 'close') closeCb = cb; },
    };
  };
  const timer = mkFakeTimer();
  const { hook, flush, status } = createLayoutDeployHook({
    stateDir: dir,
    engineConfig: { vsn1: { deployLayout: true } },
    spawnFn: gatedSpawn,
    setTimeoutFn: timer.setTimeoutFn,
    clearTimeoutFn: timer.clearTimeoutFn,
  });
  // Page-0-only clamp (own-page retirement): every layout change queues page 0.
  // A first page-0 flash goes in flight; a SECOND page-0 change lands mid-flight
  // and must NOT open a second COM12 handle — it waits for the drain to advance.
  await hook(layoutEvt([0], 1));
  timer.fire();
  // Let the first spawn start.
  await new Promise(r => setImmediate(r));
  assert.equal(alive, 1, 'exactly one CLI in flight');
  assert.equal(status.deploying, true);
  // A NEW page-0 change mid-flight must not launch a second child.
  await hook(layoutEvt([0], 2));
  timer.fire();
  await new Promise(r => setImmediate(r));
  assert.equal(alive, 1, 'a mid-flight change does NOT open a second COM12 handle');
  // Release children one at a time; the loop advances serially.
  while (releases.length) {
    releases.shift()();
    await new Promise(r => setImmediate(r));
  }
  await flush();
  assert.equal(maxAlive, 1, 'never more than one deploy process alive at once');
  // Only page 0 is ever flashed — pages 1-3 are dropped at the clamp. (Filter to
  // the deploy CLI calls; a 2+-flash drain also spawns the soft_reset mitigation
  // CLI, which carries no --page.)
  const pages = calls
    .filter(c => c.args.includes('--page'))
    .map(c => c.args[c.args.indexOf('--page') + 1]);
  assert.ok(pages.length >= 1 && pages.every(p => p === '0'),
    'every flash is page 0 (serialized), never a second COM12 handle');
});

test('deploy hook fails LOUDLY on a non-zero CLI exit (no silent retry)', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vsn1-deploy3-'));
  const calls = [];
  const { hook, status, flush } = createLayoutDeployHook({
    stateDir: dir,
    engineConfig: { vsn1: { deployLayout: true } },
    spawnFn: mkFakeSpawn(calls, { code: 2, stderr: 'port busy' }),
  });
  await hook(layoutEvt([0], 1));
  await assert.rejects(flush(), /VSN1 layout deploy failed/);
  assert.equal(status.lastResult, 'error');
  assert.match(status.lastError, /port busy/);
  // No silent retry storm: the single failed page did not respawn.
  assert.equal(calls.length, 1, 'exactly one attempt — no retry loop');
});

// ── page-0-only clamp + failed-page retention (own-page retirement) ──────

test('deploy hook CLAMPS to page 0 — pages 1-3 are dropped, never flashed', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vsn1-clamp-'));
  const calls = [];
  const { hook, flush } = createLayoutDeployHook({
    stateDir: dir,
    engineConfig: { vsn1: { deployLayout: true } },
    spawnFn: mkFakeSpawn(calls),
  });
  // A whole-config replace marks ALL pages [0,1,2,3]; only page 0 reaches COM12.
  const res = await hook(layoutEvt([0, 1, 2, 3], 1));
  assert.deepEqual(res.pages, [0], 'only page 0 is queued');
  assert.deepEqual(res.droppedPages, [1, 2, 3], 'pages 1-3 dropped as invisible');
  await flush();
  assert.equal(calls.length, 1, 'exactly one CLI call — never a multi-page burst');
  assert.equal(calls[0].args[calls[0].args.indexOf('--page') + 1], '0', 'flashes ONLY --page 0');
});

test('a layout change confined to pages 1-3 flashes NOTHING (no-visible-page)', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vsn1-novis-'));
  const calls = [];
  const { hook, flush } = createLayoutDeployHook({
    stateDir: dir,
    engineConfig: { vsn1: { deployLayout: true } },
    spawnFn: mkFakeSpawn(calls),
  });
  const res = await hook(layoutEvt([2], 1)); // an edit on invisible page 2
  assert.equal(res.reason, 'no-visible-page');
  assert.deepEqual(res.pages, []);
  await flush();
  assert.equal(calls.length, 0, 'nothing flashed for an invisible-page-only change');
});

test('a FAILED page-0 deploy is RETAINED in pendingPages and RETRIED on the next change', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vsn1-retain-'));
  const calls = [];
  const { hook, status, flush } = createLayoutDeployHook({
    stateDir: dir,
    engineConfig: { vsn1: { deployLayout: true } },
    spawnFn: mkFakeSpawn(calls, { code: 2, stderr: 'LCD INIT over budget' }),
  });
  await hook(layoutEvt([0], 1));
  await assert.rejects(flush(), /VSN1 layout deploy failed/);
  assert.equal(status.lastResult, 'error');
  // The stranded-queue bug: the old code deleted the page before the attempt and
  // never re-added it on failure. Now the failed page stays queued.
  assert.deepEqual(status.pendingPages, [0], 'the failed page stays queued for retry');
  assert.equal(calls.length, 1, 'one attempt — no busy retry loop');
  // The NEXT layout event retries the retained page (not stranded forever).
  await hook(layoutEvt([0], 2));
  await assert.rejects(flush(), /VSN1 layout deploy failed/);
  assert.equal(calls.length, 2, 'the retained page is retried on the next change');
});

test('isLayoutDeployEnabled honours env + config gates', () => {
  assert.equal(isLayoutDeployEnabled({}), false);
  assert.equal(isLayoutDeployEnabled({ vsn1: { deployLayout: true } }), true);
  const prev = process.env.MARSIN_VSN1_DEPLOY;
  process.env.MARSIN_VSN1_DEPLOY = '1';
  try {
    assert.equal(isLayoutDeployEnabled({}), true);
  } finally {
    if (prev === undefined) delete process.env.MARSIN_VSN1_DEPLOY;
    else process.env.MARSIN_VSN1_DEPLOY = prev;
  }
});

// ── DEFAULT_SLOT_CONFIG sanity under the new fields ──────────────────

test('DEFAULT_SLOT_CONFIG status is coherent for page/mode/intensity', () => {
  const mgr = mkMgr();
  for (const s of mgr.getStatus()) {
    assert.ok(s.page >= MIN_PAGE && s.page <= MAX_PAGE, `slot ${s.slotId} page in range`);
    // mode fields are all-null or a coherent triple.
    if (s.modeLabel === null) {
      assert.equal(s.mode, null);
      assert.equal(s.modeValues, null);
      assert.equal(s.modeIndex, null);
    } else {
      assert.ok(Array.isArray(s.modeValues) && s.modeValues.length >= 2);
      assert.ok(s.modeValues.some(v => v === s.mode));
      assert.equal(s.modeIndex, s.modeValues.findIndex(v => v === s.mode));
    }
  }
});
