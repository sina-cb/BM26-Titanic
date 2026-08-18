import assert from 'node:assert/strict';
import test from 'node:test';

import { mapPixelsToSacn } from '../../../simulation/src/dmx/sacn_mapper.js';

import {
  LIVE_TOUCH_OVERLAY_FADE_MS,
  LiveTouchOverlayPattern,
} from '../../lib/live_touch_overlay_pattern.js';
import { applyLiveTouchCreativeBuffer } from '../../lib/live_touch_creative_processor.js';
import { loadModelForGauge } from '../../lib/model_loader.js';

const FIVE_HSV = [
  { h: 0, s: 1, v: 1 },
  { h: 0.2, s: 1, v: 1 },
  { h: 0.4, s: 1, v: 1 },
  { h: 0.6, s: 1, v: 1 },
  { h: 0.8, s: 1, v: 1 },
];

function pixels() {
  return [
    { group: 'Bow', r: 0.2, g: 0.3, b: 0.4, w: 0, a: 0, u: 0 },
    { group: 'Bow', r: 0.1, g: 0.2, b: 0.3, w: 0, a: 0, u: 0 },
    { group: 'Stern', r: 0.3, g: 0.1, b: 0.2, w: 0, a: 0, u: 0 },
  ];
}

function snapshot(source) {
  return source.map(pixel => [pixel.r, pixel.g, pixel.b, pixel.w, pixel.a, pixel.u]);
}

function restore(source, values) {
  source.forEach((pixel, index) => {
    [pixel.r, pixel.g, pixel.b, pixel.w, pixel.a, pixel.u] = values[index];
  });
}

function mappedFrame(modelPixels, buffer) {
  const frames = new Map();
  const router = {
    addUniverse(universe) {
      if (!frames.has(universe)) frames.set(universe, new Uint8Array(512));
    },
    getFullFrame(universe) {
      return frames.get(universe) || null;
    },
  };
  const pixelsForMap = modelPixels.map((pixel, index) => {
    const offset = index * 6;
    return {
      ...pixel,
      r: buffer[offset] / 255,
      g: buffer[offset + 1] / 255,
      b: buffer[offset + 2] / 255,
      w: buffer[offset + 3] / 255,
      a: buffer[offset + 4] / 255,
      u: buffer[offset + 5] / 255,
    };
  });
  mapPixelsToSacn(pixelsForMap, router);
  const universes = [...frames.keys()].sort((left, right) => left - right);
  const out = new Uint8Array(universes.length * 512);
  universes.forEach((universe, index) => out.set(frames.get(universe), index * 512));
  return out;
}

const PULSE_PARAMS = {
  mode: 'pulse', travel: 'repeat', amount: 1, fadeSpan: 0, sync: 'free',
  pixelsPerSecond: 0, burstMs: 200, decayMs: 5000, floor: 0.04,
};

test('Live Touch overlay is transparent at zero alpha and byte-identical after fade-off', () => {
  const source = pixels();
  const overlay = new LiveTouchOverlayPattern(source);
  overlay.setPalette(FIVE_HSV);
  const base = snapshot(source);

  overlay.composite(source, { nowMs: 0 });
  assert.deepEqual(snapshot(source), base, 'an unselected overlay must not touch the background');

  overlay.dispatch({
    slotId: 9, presetId: 'pulse_slow_fade', params: PULSE_PARAMS,
    action: 'activate', behavior: 'toggle', nowMs: 0,
  });
  overlay.composite(source, { nowMs: 0 });
  assert.deepEqual(snapshot(source), base, 'activation begins fully transparent');
  assert.equal(overlay.getStatus(500).alpha, 0.5);
  assert.equal(overlay.getStatus(LIVE_TOUCH_OVERLAY_FADE_MS).alpha, 1);

  restore(source, base);
  overlay.composite(source, { nowMs: LIVE_TOUCH_OVERLAY_FADE_MS });
  assert.notDeepEqual(snapshot(source), base, 'the active generator lightens rather than replaces base');

  overlay.dispatch({
    slotId: 9, presetId: 'pulse_slow_fade', params: PULSE_PARAMS,
    action: 'deactivate', behavior: 'toggle', nowMs: LIVE_TOUCH_OVERLAY_FADE_MS,
  });
  assert.equal(overlay.getStatus(1500).alpha, 0.5);
  restore(source, base);
  overlay.composite(source, { nowMs: 2000 });
  assert.deepEqual(snapshot(source), base,
    'a fully faded-off overlay must restore the base pixels byte-for-byte');
});

test('five-colour generators refuse unstaged palette and use an exact staged session palette', () => {
  const source = pixels();
  const overlay = new LiveTouchOverlayPattern(source);
  const fiveParams = {
    mode: 'one_per_color', travel: 'repeat', amount: 1, fadeSpan: 1,
    sync: 'beat', pixelsPerBeat: 1,
  };

  assert.throws(() => overlay.dispatch({
    slotId: 13, presetId: 'one_per_color_repeat', params: fiveParams,
    action: 'activate', behavior: 'toggle', nowMs: 0,
  }), error => error.code === 'LIVE_TOUCH_OVERLAY_PALETTE_REQUIRED');

  const staged = FIVE_HSV.map(color => ({ ...color }));
  overlay.setPalette(staged);
  staged[0].h = 0.9;
  assert.deepEqual(overlay.getPalette(), FIVE_HSV,
    'the session overlay stores and returns palette objects by value');
  overlay.dispatch({
    slotId: 13, presetId: 'one_per_color_repeat', params: fiveParams,
    action: 'activate', behavior: 'toggle', nowMs: 0,
  });
  overlay.composite(source, { nowMs: 1000, signals: { bpm: 120 } });
  assert.notDeepEqual(snapshot(source), snapshot(pixels()),
    'the staged five-HSV palette must produce visible overlay output');
});

test('one Live overlay has one authoritative selected identity and reverses same-slot fade', () => {
  const source = pixels();
  const overlay = new LiveTouchOverlayPattern(source);
  overlay.setPalette(FIVE_HSV);

  overlay.dispatch({
    slotId: 9, presetId: 'pulse_slow_fade', params: PULSE_PARAMS,
    action: 'activate', behavior: 'toggle', nowMs: 0,
  });
  overlay.dispatch({
    slotId: 16, presetId: 'whole_group_repeat', params: {
      mode: 'whole_group', travel: 'repeat', amount: 1, fadeSpan: 1,
      sync: 'beat', pixelsPerBeat: 1,
    }, action: 'activate', behavior: 'toggle', nowMs: 400 });
  const switched = overlay.getStatus(400);
  assert.equal(switched.slotId, 16);
  assert.equal(switched.presetId, 'whole_group_repeat');
  assert.equal(switched.alpha, 0, 'a replacement starts its own exact one-second fade');
  assert.equal(overlay.isActiveForSlot(9, 800), false, 'the replaced slot cannot stay active');

  overlay.dispatch({
    slotId: 16, presetId: 'whole_group_repeat', params: {
      mode: 'whole_group', travel: 'repeat', amount: 1, fadeSpan: 1,
      sync: 'beat', pixelsPerBeat: 1,
    }, action: 'deactivate', behavior: 'toggle', nowMs: 900 });
  assert.equal(overlay.getStatus(1400).alpha, 0.25);
  overlay.dispatch({
    slotId: 16, presetId: 'whole_group_repeat', params: {
      mode: 'whole_group', travel: 'repeat', amount: 1, fadeSpan: 1,
      sync: 'beat', pixelsPerBeat: 1,
    }, action: 'activate', behavior: 'toggle', nowMs: 1400 });
  assert.equal(overlay.getStatus(1400).alpha, 0.25,
    're-enabling the same slot reverses from its rendered alpha, not zero');
  assert.equal(overlay.getStatus(2400).alpha, 1);
});

test('Titanic 6ch frame: overlay envelope is bounded, targets every real group, and restores base', async () => {
  const model = await loadModelForGauge('titanic');
  const overlay = new LiveTouchOverlayPattern(model.pixels);
  overlay.setPalette(FIVE_HSV);
  const params = {
    mode: 'one_per_color', travel: 'repeat', amount: 1, fadeSpan: 1,
    sync: 'free', pixelsPerSecond: 0,
  };
  const base = new Uint8Array(model.pixels.length * 6);
  for (let index = 0; index < base.length; index++) base[index] = 8 + ((index * 17) % 32);
  const render = nowMs => {
    const frame = base.slice();
    applyLiveTouchCreativeBuffer({
      buffer6ch: frame,
      modelPixels: model.pixels,
      globalEffectsController: null,
      liveTouchOverlayPattern: overlay,
      frameIndex: Math.round(nowMs / 25),
      nowMs,
      signals: { bpm: 120 },
    });
    return frame;
  };

  overlay.dispatch({
    slotId: 13, presetId: 'one_per_color_repeat', params,
    action: 'activate', behavior: 'toggle', nowMs: 0,
  });
  const zero = render(0);
  const fadeIn = render(500);
  const on = render(1000);
  assert.deepEqual(zero, base, 'zero alpha and its black scratch are byte-identical to base');
  for (let index = 0; index < base.length; index++) {
    assert.ok(fadeIn[index] >= base[index], `fade-in lane ${index} must never darken base`);
    assert.ok(fadeIn[index] <= on[index], `fade-in lane ${index} must stay bounded by full overlay`);
    assert.ok(on[index] >= base[index], `full overlay lane ${index} must never darken base`);
  }
  for (let index = 3; index < base.length; index += 6) {
    assert.equal(on[index], base[index], 'black W overlay lane must be a no-op');
    assert.equal(on[index + 1], base[index + 1], 'black A overlay lane must be a no-op');
    assert.equal(on[index + 2], base[index + 2], 'black U overlay lane must be a no-op');
  }

  const requiredGroups = [
    'TE Sign', 'TE Sign 2', 'Left Front Wall', 'Right Front Wall',
    'Left Auditorium', 'Right Auditorium',
  ];
  for (const group of requiredGroups) {
    const indices = model.pixels
      .map((pixel, index) => (pixel.group === group ? index : -1))
      .filter(index => index >= 0);
    assert.ok(indices.length > 0, `Titanic model must retain target group '${group}'`);
    assert.ok(indices.some(index => {
      const offset = index * 6;
      return on[offset] > base[offset] || on[offset + 1] > base[offset + 1]
        || on[offset + 2] > base[offset + 2];
    }), `overlay must visibly target '${group}'`);
  }
  // The operator shorthand Hull/Vintage/Organs maps to fixture/view taxonomy,
  // not literal model group names. Lock the actual generated model types so
  // a group rename cannot silently reduce overlay coverage.
  const requiredFixtureTypes = [
    'VintageLed', 'UkingPar', 'ShehdsBar', 'TeSignV3A40', 'TeSignV3B34',
  ];
  for (const fixtureType of requiredFixtureTypes) {
    const indices = model.pixels
      .map((pixel, index) => (pixel.fixtureType === fixtureType ? index : -1))
      .filter(index => index >= 0);
    assert.ok(indices.length > 0, `Titanic fixture taxonomy must retain '${fixtureType}'`);
    assert.ok(indices.some(index => {
      const offset = index * 6;
      return on[offset] > base[offset] || on[offset + 1] > base[offset + 1]
        || on[offset + 2] > base[offset + 2];
    }), `overlay must visibly cover '${fixtureType}' fixture output`);
  }
  const allGroups = new Set(model.pixels.map(pixel => pixel.group));
  for (const group of allGroups) {
    assert.ok(model.pixels.some((pixel, index) => {
      if (pixel.group !== group) return false;
      const offset = index * 6;
      return on[offset] > base[offset] || on[offset + 1] > base[offset + 1]
        || on[offset + 2] > base[offset + 2];
    }), `one-per-colour overlay must cover real Titanic group '${group}'`);
  }

  overlay.dispatch({
    slotId: 13, presetId: 'one_per_color_repeat', params,
    action: 'deactivate', behavior: 'toggle', nowMs: 1000,
  });
  const fadeOut = render(1500);
  const off = render(2000);
  for (let index = 0; index < base.length; index++) {
    assert.ok(fadeOut[index] >= base[index], `fade-out lane ${index} must never darken base`);
    assert.ok(fadeOut[index] <= on[index], `fade-out lane ${index} must remain bounded`);
  }
  assert.deepEqual(off, base, 'one-second fade-off restores the real Titanic 6ch base byte-for-byte');

  const moving = { ...params, pixelsPerSecond: 2 };
  overlay.dispatch({
    slotId: 13, presetId: 'one_per_color_repeat', params: moving,
    action: 'activate', behavior: 'toggle', nowMs: 2000,
  });
  const motionStart = render(3000);
  const motionLater = render(3500);
  assert.notDeepEqual(motionLater, motionStart,
    'a real Titanic 6ch overlay frame must advance after it has fully faded in');
  assert.notDeepEqual(mappedFrame(model.pixels, motionLater), mappedFrame(model.pixels, motionStart),
    'the advancing overlay must reach a changed mapped 6ch output frame without opening a port');
});
