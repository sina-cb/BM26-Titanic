import assert from 'node:assert/strict';
import test from 'node:test';

import { LiveBrightnessController } from '../../lib/live_brightness_controller.js';
import {
  applyLiveTouchCreativeBuffer,
  enforceLiveDimmerAuthority,
} from '../../lib/live_touch_creative_processor.js';

function modelPixel(sectionId, group) {
  return {
    sId: sectionId,
    group,
    r: 0, g: 0, b: 0, w: 0, a: 0, u: 0,
  };
}

test('Live group zero clamps setting-local paint and effects before the shared blend', () => {
  const liveBrightness = new LiveBrightnessController(() => 1000);
  const active = liveBrightness.activate('touch_a', [11]);
  liveBrightness.replace('touch_a', active.revision, 1, new Map([[11, 0]]));

  const calls = [];
  const globalEffects = {
    effectGroupMask: null,
    applyPixels(pixels) {
      calls.push('level');
      pixels[0].w = 1;
    },
    applyGroupFixedColors(pixels, phase) {
      calls.push(phase);
      if (phase === 'post') pixels[0].r = 1;
    },
    applyMacros({ pixels }) {
      calls.push('macros');
      pixels[0].g = 1;
    },
    applyInvert() { calls.push('invert'); },
    applyPostInvert() { calls.push('postInvert'); },
    applySpatialStage({ pixels }) {
      calls.push('spatial');
      pixels[0].b = 1;
    },
  };
  const buffer = new Uint8Array([255, 255, 255, 255, 255, 255]);
  applyLiveTouchCreativeBuffer({
    buffer6ch: buffer,
    modelPixels: [modelPixel(11, 'Bow')],
    globalEffectsController: globalEffects,
    liveBrightnessController: liveBrightness,
    frameIndex: 1,
    nowMs: 1000,
  });

  assert.deepEqual([...buffer], [0, 0, 0, 0, 0, 0]);
  assert.deepEqual(calls, ['level', 'pre', 'macros', 'invert', 'postInvert', 'post', 'spatial']);
});

test('Live creative processing is setting-local and does not scale another surface buffer', () => {
  const liveBrightness = new LiveBrightnessController(() => 1000);
  const active = liveBrightness.activate('touch_a', [11]);
  liveBrightness.replace('touch_a', active.revision, 0.5, new Map([[11, 0.5]]));
  const live = new Uint8Array([200, 200, 200, 200, 200, 200]);
  const deck = new Uint8Array([100, 100, 100, 100, 100, 100]);

  applyLiveTouchCreativeBuffer({
    buffer6ch: live,
    modelPixels: [modelPixel(11, 'Bow')],
    globalEffectsController: null,
    liveBrightnessController: liveBrightness,
    frameIndex: 1,
    nowMs: 1000,
  });

  assert.deepEqual([...live], [50, 50, 50, 50, 50, 50]);
  assert.deepEqual([...deck], [100, 100, 100, 100, 100, 100]);
});

test('Live overlay is composited once after private macros without re-entering shared movement', () => {
  const calls = [];
  const noOp = () => {};
  const effects = {
    effectGroupMask: null,
    parkedGroupMask: null,
    applyPixels() { calls.push('level'); },
    applyGroupFixedColors(_pixels, phase) { calls.push(phase); },
    applyMacros({ pixels }) { calls.push('macros'); pixels[0].r = 0.4; },
    applyInvert() { calls.push('invert'); },
    applyPostInvert() { calls.push('postInvert'); },
    applySpatialStage: noOp,
  };
  const overlay = {
    composite(pixels) {
      calls.push('overlay');
      pixels[0].r = Math.max(pixels[0].r, 0.8);
    },
  };
  const buffer = new Uint8Array(6);

  applyLiveTouchCreativeBuffer({
    buffer6ch: buffer,
    modelPixels: [modelPixel(11, 'Bow')],
    globalEffectsController: effects,
    liveTouchOverlayPattern: overlay,
    frameIndex: 1,
    nowMs: 1000,
  });

  assert.equal(buffer[0], 204, 'max/lighten overlay adds without replacing the base chain');
  assert.deepEqual(calls, ['level', 'pre', 'macros', 'invert', 'postInvert', 'overlay', 'post'],
    'one Live render executes the overlay exactly once at its dedicated chain anchor');
});

test('setting master uses local parked groups, then Live brightness still owns every group', () => {
  const liveBrightness = new LiveBrightnessController(() => 1000);
  const active = liveBrightness.activate('touch_a', [11, 22]);
  liveBrightness.replace(
    'touch_a',
    active.revision,
    0.5,
    new Map([[11, 1], [22, 1]]),
  );
  const noOp = () => {};
  const effects = {
    effectGroupMask: null,
    parkedGroupMask: new Set(['Parked']),
    applyPixels: noOp,
    applyGroupFixedColors: noOp,
    applyMacros: noOp,
    applyInvert: noOp,
    applyPostInvert: noOp,
    applySpatialStage: noOp,
  };
  const pixels = [modelPixel(11, 'Parked'), modelPixel(22, 'Ordinary')];
  const buffer = new Uint8Array(12).fill(200);

  applyLiveTouchCreativeBuffer({
    buffer6ch: buffer,
    modelPixels: pixels,
    globalEffectsController: effects,
    liveBrightnessController: liveBrightness,
    master: 0.5,
    frameIndex: 1,
    nowMs: 1000,
  });

  assert.deepEqual([...buffer.slice(0, 6)], [100, 100, 100, 100, 100, 100],
    'parked skips the shared grand master but not Live brightness');
  assert.deepEqual([...buffer.slice(6)], [50, 50, 50, 50, 50, 50],
    'ordinary group receives both shared master and Live brightness');
});

test('Live creative effects cannot leave a Dimmer Rack bypass flag behind', () => {
  const liveBrightness = new LiveBrightnessController(() => 1000);
  liveBrightness.activate('touch_a', [11]);
  const pixel = modelPixel(11, 'Bow');
  const noOp = () => {};
  const effects = {
    effectGroupMask: null,
    parkedGroupMask: null,
    applyPixels(pixels) {
      pixels[0].ignoreDimmerForRGB = true;
      pixels[0].ignoreDimmerForW = true;
      pixels[0].ignoreDimmerForA = true;
      pixels[0].ignoreDimmerForU = true;
    },
    applyGroupFixedColors: noOp,
    applyMacros: noOp,
    applyInvert: noOp,
    applyPostInvert: noOp,
    applySpatialStage: noOp,
  };

  applyLiveTouchCreativeBuffer({
    buffer6ch: new Uint8Array(6).fill(255),
    modelPixels: [pixel],
    globalEffectsController: effects,
    liveBrightnessController: liveBrightness,
    frameIndex: 1,
    nowMs: 1000,
  });

  assert.equal(pixel.ignoreDimmerForRGB, false);
  assert.equal(pixel.ignoreDimmerForW, false);
  assert.equal(pixel.ignoreDimmerForA, false);
  assert.equal(pixel.ignoreDimmerForU, false);
});

test('Dimmer bypass metadata is cleared only when Live participates', () => {
  const sharedOnly = [{
    ignoreDimmerForRGB: true,
    ignoreDimmerForW: true,
    ignoreDimmerForA: true,
    ignoreDimmerForU: true,
  }];
  enforceLiveDimmerAuthority(sharedOnly, false);
  assert.deepEqual(sharedOnly[0], {
    ignoreDimmerForRGB: true,
    ignoreDimmerForW: true,
    ignoreDimmerForA: true,
    ignoreDimmerForU: true,
  });

  const withLive = [{ ...sharedOnly[0] }];
  enforceLiveDimmerAuthority(withLive, true);
  assert.deepEqual(withLive[0], {
    ignoreDimmerForRGB: false,
    ignoreDimmerForW: false,
    ignoreDimmerForA: false,
    ignoreDimmerForU: false,
  });
});
