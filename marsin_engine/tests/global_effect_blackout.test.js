/**
 * Unit tests for the unified e-stop / blackout precedence (May 2026).
 *
 * The contract the operator asked for:
 *   - Blackout is the highest-priority safety state.
 *   - When blackout engages, every active macro / legacy global effect
 *     must be cleared so that releasing blackout starts from a clean
 *     slate (no surprise strobe resuming after release).
 *   - Pixel buffer goes to zero while blackout is active, no matter
 *     what macros are running.
 *   - DMX-only fixtures (fogger / horn / fire) are silenced too —
 *     pixel-level blackout alone wouldn't reach them.
 *
 * Run: node --test marsin_engine/tests/global_effect_blackout.test.js
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { GlobalEffectsController } from '../lib/global_effects_controller.js';
import { GlobalEffectSlotManager } from '../lib/global_effect_slot_manager.js';
import { IntensityController } from '../lib/intensity_controller.js';

function makePixels(n = 4) {
  const out = [];
  for (let i = 0; i < n; i++) {
    out.push({ r: 0.5, g: 0.4, b: 0.3, w: 0.2, a: 0.1, u: 0.05 });
  }
  return out;
}

test('panic stop also clears legacy rig-global effects', () => {
  const ctrl = new GlobalEffectsController({ engine: { fps: 40 } });
  const mgr = new GlobalEffectSlotManager(ctrl);
  // Activate the four legacy effects via the slot dispatcher.
  mgr.dispatchSlotAction({ slotId: 7,  action: 'activate', frameIndex: 0, nowMs: 0 }); // vintageWhite
  mgr.dispatchSlotAction({ slotId: 8,  action: 'activate', frameIndex: 0, nowMs: 0 }); // blastWhite
  mgr.dispatchSlotAction({ slotId: 9,  action: 'activate', frameIndex: 0, nowMs: 0 }); // uvBlast
  mgr.dispatchSlotAction({ slotId: 10, action: 'activate', frameIndex: 0, nowMs: 0 }); // fogger
  assert.equal(ctrl.effects.vintageWhite, true);
  assert.equal(ctrl.effects.blastWhite,   true);
  assert.equal(ctrl.effects.uvBlast,      true);
  assert.equal(ctrl.effects.fogger,       true);

  ctrl.panicStop();

  assert.equal(ctrl.effects.vintageWhite, false);
  assert.equal(ctrl.effects.blastWhite,   false);
  assert.equal(ctrl.effects.uvBlast,      false);
  assert.equal(ctrl.effects.fogger,       false);
});

test('IntensityController blackout zeroes pixels even with macros running', () => {
  // Mimic the engine render pipeline: macros first, then intensity/blackout.
  const ctrl = new GlobalEffectsController({ engine: { fps: 40 } });
  const ic = new IntensityController();
  ctrl.setColorWash(true, 'emergency_red', 1.0, 'replace');
  ic.setBlackout(true);

  const pixels = makePixels(3);
  ctrl.applyMacros({ pixels, frameIndex: 0, nowMs: 0 });
  // Wash drove pixels to red; without blackout we'd see r>0.
  ic.apply(pixels);
  for (const p of pixels) {
    assert.equal(p.r, 0); assert.equal(p.g, 0); assert.equal(p.b, 0);
    assert.equal(p.w, 0); assert.equal(p.a, 0); assert.equal(p.u, 0);
  }
});

test('applyDmx with blackout=true silences fogger / horn / fire even when their flags are on', () => {
  const ctrl = new GlobalEffectsController({ engine: { fps: 40 } });
  ctrl.foggers = [{ fixtureType: 'GenericFogger', universe: 1, address: 5 }];
  ctrl.horns   = [{ fixtureType: 'AirHorn',       universe: 1, address: 10 }];
  ctrl.fires   = [{ fixtureType: 'PropaneFire',   universe: 1, address: 15 }];
  ctrl.setEffect('fogger', true);
  ctrl.setEffect('horn',   true);
  ctrl.setEffect('fire',   true);

  const dmx = { 1: new Uint8Array(50) };
  // Sanity: without blackout the fogger byte is 255.
  ctrl.applyDmx(dmx);
  assert.equal(dmx[1][4], 255);
  assert.equal(dmx[1][9], 255);
  assert.equal(dmx[1][14], 255);

  ctrl.applyDmx(dmx, { blackout: true });
  assert.equal(dmx[1][4],  0, 'fogger DMX byte must be 0 during blackout');
  assert.equal(dmx[1][9],  0, 'horn DMX byte must be 0 during blackout');
  assert.equal(dmx[1][14], 0, 'fire DMX byte must be 0 during blackout');
});

test('blackout precedence: pixels stay zero whether strobe gate is ON or OFF', () => {
  const ctrl = new GlobalEffectsController({ engine: { fps: 40 } });
  const ic = new IntensityController();
  // 20Hz strobe so cycle is 2 frames — frame 0 ON, frame 1 OFF.
  ctrl.setStrobe(true, 20, 0.5, 1.0, 0, {});
  ic.setBlackout(true);

  for (const frameIndex of [0, 1, 2, 3]) {
    const pixels = makePixels(2);
    ctrl.applyMacros({ pixels, frameIndex, nowMs: frameIndex * 25 });
    ic.apply(pixels);
    for (const p of pixels) {
      assert.equal(p.r + p.g + p.b + p.w + p.a + p.u, 0,
        `blackout must dominate strobe phase (frame ${frameIndex})`);
    }
  }
});

test('legacy effect toggle round-trip via slot manager mirrors controller.effects', () => {
  const ctrl = new GlobalEffectsController({ engine: { fps: 40 } });
  const mgr = new GlobalEffectSlotManager(ctrl);
  // Toggle vintageWhite ON then OFF.
  mgr.dispatchSlotAction({ slotId: 7, action: 'toggle', frameIndex: 0, nowMs: 0 });
  assert.equal(ctrl.effects.vintageWhite, true);
  let status = mgr.getStatus().find(s => s.slotId === 7);
  assert.equal(status.active, true);
  mgr.dispatchSlotAction({ slotId: 7, action: 'toggle', frameIndex: 0, nowMs: 0 });
  assert.equal(ctrl.effects.vintageWhite, false);
  status = mgr.getStatus().find(s => s.slotId === 7);
  assert.equal(status.active, false);
});

test('slot dispatcher does NOT touch *BypassDimmer flag (dimmer rack owns it)', () => {
  // Operator review May 2026: the old `bypass_dimmer` preset twin
  // produced a second-source-of-truth for the bypass flag. The slot
  // dispatcher used to stamp it on activate / deactivate, fighting
  // the dimmer-rack BypassCheckbox. The library now has ONE preset
  // per legacy effect and the dispatcher leaves the bypass flag
  // exactly where the dimmer rack last put it. This test pins that
  // invariant so a future regression yells loudly.
  const ctrl = new GlobalEffectsController({ engine: { fps: 40 } });
  const mgr = new GlobalEffectSlotManager(ctrl);

  // Dimmer rack pre-sets the bypass flag on (as if the operator
  // ticked the checkbox in the rack tab).
  ctrl.setEffect('vintageWhiteBypassDimmer', true);

  // Activate the legacy slot — the flag must stay where the rack
  // put it, ie. on.
  mgr.dispatchSlotAction({ slotId: 7, action: 'activate', frameIndex: 0, nowMs: 0 });
  assert.equal(ctrl.effects.vintageWhite, true);
  assert.equal(ctrl.effects.vintageWhiteBypassDimmer, true,
    'activate must not stomp the rack-owned bypass flag');

  // Deactivate — flag still stays where the rack put it.
  mgr.dispatchSlotAction({ slotId: 7, action: 'deactivate', frameIndex: 0, nowMs: 0 });
  assert.equal(ctrl.effects.vintageWhite, false);
  assert.equal(ctrl.effects.vintageWhiteBypassDimmer, true,
    'deactivate must not clear the rack-owned bypass flag');

  // And panicStop (e-stop) clears EVERYTHING including the bypass
  // flag, as before.
  ctrl.panicStop();
  assert.equal(ctrl.effects.vintageWhiteBypassDimmer, false,
    'panicStop still clears the bypass flag as part of total reset');
});
