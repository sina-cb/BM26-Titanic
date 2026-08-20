// Unit tests for the MOTION glide — numeric (float) param slew.
//
// The colour palettes have ramped since docs/36, but every numeric param
// SNAPPED: `slew: true` appeared only on colorPalette1/2, so a rotate change
// jumped the pattern's orientation in one frame. That is one of the things
// that makes engaging a manual surface look jerky.
//
// `rotate` is now slewed, timed by its own `motionTransitionMs` rather than by
// `colorTransitionMs` — a colour crossfade and a motion glide are separate
// musical decisions.
//
// THE IMPORTANT TEST HERE IS THE DEFAULT: motionTransitionMs defaults to 0, so
// out of the box this must behave EXACTLY like the old snap. A rig that quietly
// started easing its motion after an upgrade would be a nasty mid-show
// surprise, so that is pinned first and hardest.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import { ParamCenter } from '../../lib/param_center.js';

function tmpStatePath() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'motiontrans_test_'));
  return path.join(dir, 'state.yaml');
}

/** Fake wasmHost recording the last scalar injected per control id. */
function fakeHost() {
  const last = {};
  return {
    last,
    setControl(_handle, id, a, b, c) { last[id] = { a, b, c }; },
  };
}

const ROTATE_ID = 21;

function registerRotate(pc) {
  pc.registerChannel('deck', { __h: true }, [{ id: ROTATE_ID, name: 'rotate' }]);
}

test('motionTransitionMs is registered, persistent, and defaults to 0 (snap)', () => {
  const pc = new ParamCenter(tmpStatePath());
  const e = pc.getSchema().find((s) => s.key === 'motionTransitionMs');
  assert.ok(e, 'motionTransitionMs present in schema');
  assert.equal(e.persist, true);
  assert.equal(e.default, 0, 'DEFAULT MUST BE 0 — no silent behaviour change on upgrade');
  assert.deepEqual(e.range, [0, 10000]);
});

test('rotate is flagged slew; speed/size are not', () => {
  const pc = new ParamCenter(tmpStatePath());
  assert.ok(pc._slewKeys.includes('rotate'), 'rotate must be slewed');
  assert.ok(pc._slewKeys.includes('colorPalette1'), 'colour slew must be untouched');
  assert.ok(!pc._slewKeys.includes('speed'), 'speed is engine-owned — left alone deliberately');
  assert.ok(!pc._slewKeys.includes('size'), 'size is engine-owned — left alone deliberately');
});

test('DEFAULT (motionTransitionMs = 0): rotate SNAPS, exactly as before float slew', () => {
  const pc = new ParamCenter(tmpStatePath());
  registerRotate(pc);
  pc.set('rotate', 0.0, 'api');
  pc.tickColorTransitions(0);

  pc.set('rotate', 0.9, 'api');
  pc.tickColorTransitions(1);          // first tick after the write
  assert.equal(pc._rendered.rotate, 0.9, 'with a 0 ms glide the rendered value must equal the target immediately');

  const host = fakeHost();
  pc.flushDirty(host);
  assert.equal(host.last[ROTATE_ID].a, 0.9, 'and the snapped value must be what reaches the VM');
});

test('with a glide set, rotate eases toward the target instead of jumping', () => {
  const pc = new ParamCenter(tmpStatePath());
  registerRotate(pc);
  pc.set('motionTransitionMs', 1000, 'api');
  pc.set('rotate', 0.0, 'api');
  pc.tickColorTransitions(0);
  assert.equal(pc._rendered.rotate, 0.0);

  pc.set('rotate', 1.0, 'api');
  pc.tickColorTransitions(1000);       // ramp start (arms the clock)
  const quarter = (pc.tickColorTransitions(1250), pc._rendered.rotate);
  const half = (pc.tickColorTransitions(1500), pc._rendered.rotate);
  const threeQ = (pc.tickColorTransitions(1750), pc._rendered.rotate);

  for (const [label, v] of [['quarter', quarter], ['half', half], ['threeQ', threeQ]]) {
    assert.ok(Number.isFinite(v), `${label} must be a finite number, got ${v}`);
    assert.ok(v > 0 && v < 1, `${label} must be strictly between the endpoints (got ${v}) — that is the whole point`);
  }
  assert.ok(quarter < half && half < threeQ, 'the glide must advance monotonically');
  assert.ok(Math.abs(half - 0.5) < 0.02, `easeInOut should be ~half-way at the midpoint, got ${half}`);
});

test('the glide LANDS exactly on the target and then settles', () => {
  const pc = new ParamCenter(tmpStatePath());
  registerRotate(pc);
  pc.set('motionTransitionMs', 500, 'api');
  pc.set('rotate', 0.25, 'api');
  pc.tickColorTransitions(0);

  pc.set('rotate', 0.75, 'api');
  pc.tickColorTransitions(100);
  pc.tickColorTransitions(700);        // past the end
  assert.equal(pc._rendered.rotate, 0.75, 'must land exactly on the target, not near it');
  assert.equal(pc._rampFrom.rotate, null, 'and the ramp must be cleared so it stops ticking');
});

test('motion and colour glides are timed INDEPENDENTLY', () => {
  const pc = new ParamCenter(tmpStatePath());
  pc.registerChannel('deck', { __h: true }, [
    { id: ROTATE_ID, name: 'rotate' },
    { id: 11, name: 'colorPalette1' },
  ]);
  // Motion glides slowly; colour is instant.
  pc.set('motionTransitionMs', 4000, 'api');
  pc.set('colorTransitionMs', 0, 'api');
  pc.set('rotate', 0.0, 'api');
  pc.set('colorPalette1', { h: 0.0, s: 1, v: 1 }, 'api');
  pc.tickColorTransitions(0);

  pc.set('rotate', 1.0, 'api');
  pc.set('colorPalette1', { h: 0.5, s: 1, v: 1 }, 'api');
  pc.tickColorTransitions(10);
  pc.tickColorTransitions(110);

  assert.ok(pc._rendered.rotate < 0.2,
    `rotate must still be gliding on a 4 s glide, got ${pc._rendered.rotate}`);
  assert.equal(pc._rendered.colorPalette1.h, 0.5,
    'colour must have snapped — a 0 ms colour fade must not be slowed by the motion glide');
});

test('REGRESSION: colour ramps still honour colorTransitionMs, not motionTransitionMs', () => {
  const pc = new ParamCenter(tmpStatePath());
  pc.registerChannel('deck', { __h: true }, [{ id: 11, name: 'colorPalette1' }]);
  pc.set('colorTransitionMs', 1000, 'api');
  pc.set('motionTransitionMs', 0, 'api');   // must NOT make the colour snap
  pc.set('colorPalette1', { h: 0.0, s: 1, v: 1 }, 'api');
  pc.tickColorTransitions(0);

  pc.set('colorPalette1', { h: 0.5, s: 1, v: 1 }, 'api');
  pc.tickColorTransitions(1000);
  pc.tickColorTransitions(1500);            // half way through the colour fade
  const h = pc._rendered.colorPalette1.h;
  assert.ok(h > 0.0 && h < 0.5,
    `colour must still be mid-crossfade (got h=${h}) — a 0 ms MOTION glide must not affect colour`);
});

test('a slewed float injects its RAMPED value into the VM, not the raw target', () => {
  const pc = new ParamCenter(tmpStatePath());
  registerRotate(pc);
  pc.set('motionTransitionMs', 1000, 'api');
  pc.set('rotate', 0.0, 'api');
  pc.tickColorTransitions(0);

  pc.set('rotate', 1.0, 'api');
  pc.tickColorTransitions(1000);
  pc.tickColorTransitions(1500);

  const host = fakeHost();
  pc.flushDirty(host);
  const injected = host.last[ROTATE_ID].a;
  assert.ok(injected > 0 && injected < 1,
    `the VM must receive the ramped value, got ${injected} — if this is 1 the glide is cosmetic only`);
  assert.equal(injected, pc._rendered.rotate, 'injected value must be exactly the rendered one');
});

test('a non-slewed float passes its raw value through _injectValue (no accidental ramping)', () => {
  const pc = new ParamCenter(tmpStatePath());
  pc.set('motionTransitionMs', 5000, 'api');
  pc.set('speed', 0.8, 'api');
  pc.tickColorTransitions(0);

  // `speed` is engineOwned, so registerChannel deliberately never binds it to a
  // WASM control — there is no injected id to inspect. Assert the contract at
  // the layer that actually decides: a non-slewed entry must yield slot.value
  // verbatim, however long the motion glide is.
  const entry = pc._registryByKey.speed;
  assert.equal(entry.slew, undefined, 'speed must not be slewed');
  assert.equal(
    pc._injectValue(entry, pc._store.speed), 0.8,
    'a non-slewed param must pass straight through regardless of motionTransitionMs',
  );
  assert.equal(pc._rendered.speed, undefined, 'and it must not even have a rendered ramp slot');
});
