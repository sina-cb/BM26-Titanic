import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { mapPixelsToSacn } from '../../../simulation/src/dmx/sacn_mapper.js';

import { applyLiveTouchCreativeBuffer } from '../../lib/live_touch_creative_processor.js';
import { ColorAutopilot } from '../../lib/color_autopilot.js';
import { GlobalEffectsController } from '../../lib/global_effects_controller.js';
import { loadModelForGauge } from '../../lib/model_loader.js';
import { ParamCenter } from '../../lib/param_center.js';
import { WasmHost } from '../../lib/wasm_host.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ENGINE_DIR = path.resolve(HERE, '..', '..');
const INSTRUMENT_FILES = [
  '128_five_colour_prism.js',
  '129_five_colour_stations.js',
  '130_spatial_paint.js',
];
const TWO_COLOR_PATTERN = `
var phase = 0.0;
var c1h = 0.0, c1s = 1.0, c1v = 1.0;
var c2h = 0.5, c2s = 1.0, c2v = 1.0;
export function colorPalette1(h, s, v) { c1h = h; c1s = s; c1v = v; }
export function colorPalette2(h, s, v) { c2h = h; c2s = s; c2v = v; }
export function beforeRender(delta) { phase = phase + delta * 0.00035; }
export function render3D(index, x, y, z) {
  var level = 0.35 + 0.65 * wave(x * 3.0 + z * 2.0 + phase);
  if (wave(x * 2.0 + phase) > 0.5) hsv(c1h, c1s, c1v * level);
  else hsv(c2h, c2s, c2v * level);
}
`;

function tmpStatePath(prefix) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}-`));
  return path.join(directory, 'state.yaml');
}

function makeRouter() {
  const frames = new Map();
  return {
    addUniverse(universe) {
      if (!frames.has(universe)) frames.set(universe, new Uint8Array(512));
    },
    getFullFrame(universe) {
      return frames.get(universe) || null;
    },
    frames,
  };
}

function setControl(host, handle, name, ...values) {
  const control = host.getExports(handle).find((entry) => entry.name === name);
  assert.ok(control, `missing exported control '${name}'`);
  host.setControl(handle, control.id, values[0], values[1] || 0, values[2] || 0);
}

function rgbRms(left, right) {
  assert.equal(left.length, right.length);
  let sumSquares = 0;
  let samples = 0;
  for (let offset = 0; offset < left.length; offset += 6) {
    for (let channel = 0; channel < 3; channel += 1) {
      const difference = left[offset + channel] - right[offset + channel];
      sumSquares += difference * difference;
      samples += 1;
    }
  }
  return Math.sqrt(sumSquares / samples);
}

function byteRms(left, right) {
  assert.equal(left.length, right.length);
  let sumSquares = 0;
  for (let index = 0; index < left.length; index += 1) {
    const difference = left[index] - right[index];
    sumSquares += difference * difference;
  }
  return Math.sqrt(sumSquares / left.length);
}

function spatialVariance(buffer) {
  const levels = [];
  for (let offset = 0; offset < buffer.length; offset += 6) {
    levels.push(buffer[offset] + buffer[offset + 1] + buffer[offset + 2]);
  }
  const mean = levels.reduce((sum, value) => sum + value, 0) / levels.length;
  return levels.reduce((sum, value) => sum + ((value - mean) ** 2), 0) / levels.length;
}

function pixelsFromBuffer(modelPixels, buffer) {
  return modelPixels.map((source, index) => {
    const offset = index * 6;
    return {
      ...source,
      r: buffer[offset] / 255,
      g: buffer[offset + 1] / 255,
      b: buffer[offset + 2] / 255,
      w: buffer[offset + 3] / 255,
      a: buffer[offset + 4] / 255,
      u: buffer[offset + 5] / 255,
    };
  });
}

function dmxFrame(modelPixels, buffer) {
  const router = makeRouter();
  mapPixelsToSacn(pixelsFromBuffer(modelPixels, buffer), router);
  const universes = [...router.frames.keys()].sort((left, right) => left - right);
  const frame = new Uint8Array(universes.length * 512);
  universes.forEach((universe, index) => {
    frame.set(router.frames.get(universe), index * 512);
  });
  assert.ok(frame.some(value => value > 0), 'mapped DMX frame must contain visible output');
  return frame;
}

function resolvePair(entry) {
  const channel = value => (
    typeof value === 'number' ? { h: value, s: 1, v: 1 } : { ...value }
  );
  return {
    colorPalette1: channel(entry.c1),
    colorPalette2: channel(entry.c2),
  };
}

function fakeClock() {
  let nowMs = 0;
  const queue = [];
  return {
    now: () => nowMs,
    schedule(fn, delayMs) {
      const handle = { fn, at: nowMs + delayMs };
      queue.push(handle);
      return handle;
    },
    clear(handle) {
      const index = queue.indexOf(handle);
      if (index >= 0) queue.splice(index, 1);
    },
    advance(deltaMs) {
      const target = nowMs + deltaMs;
      let iterations = 0;
      for (;;) {
        const next = queue
          .filter(handle => handle.at <= target)
          .sort((left, right) => left.at - right.at)[0];
        if (!next) break;
        queue.splice(queue.indexOf(next), 1);
        nowMs = next.at;
        next.fn();
        iterations += 1;
        if (iterations > 10000) throw new Error('fake color clock ran away');
      }
      nowMs = target;
    },
  };
}

async function makeRealPatternHarness(source = TWO_COLOR_PATTERN) {
  const model = await loadModelForGauge('titanic');
  const host = new WasmHost();
  await host.init(model.pixels.length);
  host.setCoords(model.pixels.map(pixel => ({ nx: pixel.nx, ny: pixel.ny, nz: pixel.nz })));
  host.setPixelMeta(model.metaArray);
  host.setFixtureConstants(model.fixtureConstants);
  const compiled = host.compile(source);
  assert.equal(compiled.ok, true, compiled.error);
  return { model, host, compiled };
}

function renderHarness(harness, elapsedSeconds) {
  harness.host.beginFrame(harness.compiled.handle, elapsedSeconds);
  return harness.host.renderAll6ch(harness.compiled.handle).slice();
}

function closeHarness(harness) {
  harness.host.destroy(harness.compiled.handle);
  harness.host.shutdown();
}

function attachParamCenter(harness) {
  const paramCenter = new ParamCenter(tmpStatePath('color-output'));
  paramCenter.registerChannel(
    'live',
    harness.compiled.handle,
    harness.host.getExports(harness.compiled.handle),
  );
  return paramCenter;
}

function flushParams(paramCenter, harness, nowMs) {
  paramCenter.tickColorTransitions(nowMs);
  paramCenter.flushDirty(harness.host);
}

function makeAutopilotHarness(paramCenter, clock, signals = null) {
  const subscribers = [];
  const writeParams = params => {
    for (const [key, value] of Object.entries(params)) {
      paramCenter.setColorAutopilotFrame(key, value);
    }
  };
  const colorAutopilot = new ColorAutopilot(
    entry => writeParams(resolvePair(entry)),
    tmpStatePath('color-autopilot-output'),
    {
      resolvePaletteFn: resolvePair,
      applyParamsFn: writeParams,
      now: clock.now,
      scheduleFrame: (fn, delayMs) => clock.schedule(fn, delayMs),
      clearFrame: handle => clock.clear(handle),
      getSignalFn: key => signals[key],
      subscribeSignalsFn: fn => {
        subscribers.push(fn);
        return () => subscribers.splice(subscribers.indexOf(fn), 1);
      },
    },
  );
  return {
    colorAutopilot,
    publishSignals() {
      subscribers.slice().forEach(subscriber => subscriber());
    },
  };
}

test('real final buffer preserves ordinary two-color pattern variance and motion', async () => {
  const harness = await makeRealPatternHarness();
  try {
    const paramCenter = attachParamCenter(harness);
    paramCenter.set('colorPalette1', { h: 0.02, s: 1, v: 1 }, 'api');
    paramCenter.set('colorPalette2', { h: 0.55, s: 1, v: 1 }, 'api');
    paramCenter.applySnapshot(harness.host);

    const first = renderHarness(harness, 0);
    const moving = renderHarness(harness, 0.5);
    assert.ok(spatialVariance(first) > 1000, 'ordinary palette must preserve spatial structure');
    assert.ok(rgbRms(first, moving) > 2, 'ordinary palette pattern must keep moving');

    const firstDmx = dmxFrame(harness.model.pixels, first);
    const movingDmx = dmxFrame(harness.model.pixels, moving);
    assert.ok(byteRms(firstDmx, movingDmx) > 0.2, 'motion must reach actual mapped DMX bytes');
  } finally {
    closeHarness(harness);
  }
});

test('daemon crossfade settles the real rendered and DMX frames at commanded time', async () => {
  const harness = await makeRealPatternHarness();
  try {
    const paramCenter = attachParamCenter(harness);
    paramCenter.set('colorTransitionMs', 800, 'api');
    paramCenter.set('colorPalette1', { h: 0.02, s: 1, v: 1 }, 'api');
    paramCenter.set('colorPalette2', { h: 0.52, s: 1, v: 1 }, 'api');
    paramCenter.applySnapshot(harness.host);
    const startParams = {
      colorPalette1: paramCenter.get('colorPalette1'),
      colorPalette2: paramCenter.get('colorPalette2'),
    };
    const start = renderHarness(harness, 0);

    const clock = fakeClock();
    const { colorAutopilot } = makeAutopilotHarness(paramCenter, clock, {});
    const target = { c1: 0.32, c2: 0.82 };
    colorAutopilot.seedCurrentParams(startParams);
    colorAutopilot.setState({
      active: true,
      mode: 'palettes',
      palettes: [target],
      delay_s: 2,
      shuffle: false,
      transitionMs: 400,
    });
    const pending = colorAutopilot.triggerNext();

    clock.advance(200);
    flushParams(paramCenter, harness, clock.now());
    const midpoint = renderHarness(harness, 0.2);
    assert.ok(rgbRms(start, midpoint) > 2, 'midpoint must leave the start frame');

    clock.advance(200);
    await pending;
    flushParams(paramCenter, harness, clock.now());
    const landed = renderHarness(harness, 0.4);
    assert.equal(paramCenter._rampFrom.colorPalette1, null);
    assert.equal(paramCenter._rendered.colorPalette1.h, target.c1);
    assert.equal(paramCenter._rendered.colorPalette2.h, target.c2);
    assert.ok(rgbRms(midpoint, landed) > 2, 'landing must leave the midpoint frame');

    const expected = await makeRealPatternHarness();
    try {
      setControl(expected.host, expected.compiled.handle, 'colorPalette1', target.c1, 1, 1);
      setControl(expected.host, expected.compiled.handle, 'colorPalette2', target.c2, 1, 1);
      renderHarness(expected, 0);
      renderHarness(expected, 0.2);
      const expectedFrame = renderHarness(expected, 0.4);
      assert.deepEqual(landed, expectedFrame, 'commanded endpoint must be the actual VM frame');
      assert.deepEqual(
        dmxFrame(harness.model.pixels, landed),
        dmxFrame(expected.model.pixels, expectedFrame),
        'commanded endpoint must reach exact mapped DMX bytes',
      );
    } finally {
      closeHarness(expected);
    }
    colorAutopilot.stop();
  } finally {
    closeHarness(harness);
  }
});

test('palette turns and follow-note change real final output frames', async () => {
  const harness = await makeRealPatternHarness();
  try {
    const paramCenter = attachParamCenter(harness);
    paramCenter.set('colorTransitionMs', 800, 'api');
    paramCenter.applySnapshot(harness.host);
    const clock = fakeClock();
    const signals = { audioNote: 0, audioNoteHue: 0.0 };
    const autopilotHarness = makeAutopilotHarness(paramCenter, clock, signals);
    const { colorAutopilot } = autopilotHarness;

    colorAutopilot.seedCurrentParams({
      colorPalette1: paramCenter.get('colorPalette1'),
      colorPalette2: paramCenter.get('colorPalette2'),
    });
    colorAutopilot.setState({
      active: true,
      mode: 'palettes',
      palettes: [{ c1: 0.05, c2: 0.55 }, { c1: 0.25, c2: 0.75 }],
      delay_s: 2,
      shuffle: false,
      transitionMs: 200,
    });
    let pending = colorAutopilot.triggerNext();
    clock.advance(200);
    await pending;
    flushParams(paramCenter, harness, clock.now());
    const turnA = renderHarness(harness, 0.2);
    pending = colorAutopilot.triggerNext();
    clock.advance(200);
    await pending;
    flushParams(paramCenter, harness, clock.now());
    const turnB = renderHarness(harness, 0.4);
    assert.ok(rgbRms(turnA, turnB) > 5, 'successive turns must change actual output');

    colorAutopilot.setState({
      active: true,
      mode: 'followNote',
      followNote: {
        schemes: ['complement'],
        methodHoldS: 60,
        methodFadeS: 1,
        noteFadeMs: 200,
        sel: [0, 1],
        shuffle: false,
      },
    });
    clock.advance(200);
    flushParams(paramCenter, harness, clock.now());
    const noteC = renderHarness(harness, 0.6);
    signals.audioNote = 4;
    signals.audioNoteHue = 4 / 12;
    autopilotHarness.publishSignals();
    clock.advance(200);
    flushParams(paramCenter, harness, clock.now());
    const noteE = renderHarness(harness, 0.8);
    assert.ok(rgbRms(noteC, noteE) > 5, 'committed note change must reach actual output');
    assert.ok(byteRms(
      dmxFrame(harness.model.pixels, noteC),
      dmxFrame(harness.model.pixels, noteE),
    ) > 0.2, 'follow-note change must reach mapped DMX bytes');
    colorAutopilot.stop();
  } finally {
    closeHarness(harness);
  }
});

for (const fileName of INSTRUMENT_FILES) {
  test(`${fileName} carries slots 3-5 into real final output without flattening`, async () => {
    const source = fs.readFileSync(path.join(ENGINE_DIR, 'patterns', fileName), 'utf8');
    const harness = await makeRealPatternHarness(source);
    try {
      setControl(harness.host, harness.compiled.handle, 'colorPalette1', 0.02, 1, 1);
      setControl(harness.host, harness.compiled.handle, 'colorPalette2', 0.18, 1, 1);
      for (const slot of [3, 4, 5]) {
        setControl(harness.host, harness.compiled.handle, `sliderHue${slot}`, slot * 0.08);
        setControl(harness.host, harness.compiled.handle, `sliderVal${slot}`, 1);
      }
      const first = renderHarness(harness, 0.25);

      let prior = first;
      for (const slot of [1, 2, 3, 4, 5]) {
        if (slot <= 2) {
          setControl(
            harness.host,
            harness.compiled.handle,
            `colorPalette${slot}`,
            0.63 + slot * 0.04,
            1,
            1,
          );
        } else {
          setControl(harness.host, harness.compiled.handle, `sliderHue${slot}`, 0.63 + slot * 0.04);
        }
        const next = renderHarness(harness, 0);
        assert.ok(rgbRms(prior, next) > 0.05,
          `${fileName} slot ${slot} must independently reach real output`);
        prior = next;
      }

      for (const slot of [3, 4, 5]) {
        setControl(harness.host, harness.compiled.handle, `sliderHue${slot}`, 0.5 + slot * 0.07);
        setControl(harness.host, harness.compiled.handle, `sliderVal${slot}`, 0.65);
      }
      const changed = renderHarness(harness, 0.25);
      assert.ok(rgbRms(first, changed) > 1,
        `${fileName} slot 3-5 edits must change final RGB output`);
      const outputColours = new Set();
      for (let offset = 0; offset < changed.length; offset += 6) {
        outputColours.add(`${changed[offset]},${changed[offset + 1]},${changed[offset + 2]}`);
      }
      assert.ok(outputColours.size > 1,
        `${fileName} must retain pattern structure outside its palette`);
      assert.ok(byteRms(
        dmxFrame(harness.model.pixels, first),
        dmxFrame(harness.model.pixels, changed),
      ) > 0.05, `${fileName} slot 3-5 edits must reach mapped DMX bytes`);
    } finally {
      closeHarness(harness);
    }
  });
}

test('130 Spatial Paint default background moves on the real Titanic output channel', async () => {
  const source = fs.readFileSync(
    path.join(ENGINE_DIR, 'patterns', '130_spatial_paint.js'),
    'utf8',
  );
  const harness = await makeRealPatternHarness(source);
  try {
    setControl(harness.host, harness.compiled.handle, 'sliderLocalSpeed', 0.5);
    setControl(harness.host, harness.compiled.handle, 'sliderLevel', 1);
    setControl(harness.host, harness.compiled.handle, 'sliderRadius', 0.45);
    setControl(harness.host, harness.compiled.handle, 'sliderGlow', 0.3);
    setControl(harness.host, harness.compiled.handle, 'sliderTargetX', 0.5);
    setControl(harness.host, harness.compiled.handle, 'sliderTargetY', 0.5);
    setControl(harness.host, harness.compiled.handle, 'sliderDrawMode', 0);
    const first = renderHarness(harness, 0);
    let second = first;
    for (let frame = 1; frame <= 40; frame += 1) {
      second = renderHarness(harness, frame * 0.025);
    }
    const colours = new Set();
    for (let offset = 0; offset < first.length; offset += 6) {
      colours.add(`${first[offset]},${first[offset + 1]},${first[offset + 2]}`);
    }
    const motion = rgbRms(first, second);
    const mappedMotion = byteRms(
      dmxFrame(harness.model.pixels, first),
      dmxFrame(harness.model.pixels, second),
    );
    assert.ok(colours.size >= 2,
      `the parked Spatial background must retain visible zone structure (${[...colours].join(' | ')})`);
    assert.ok(motion > 0.1,
      `the parked Spatial background must advance between real VM frames (${motion})`);
    assert.ok(mappedMotion > 0.01,
      `parked Spatial motion must reach mapped DMX bytes (${mappedMotion})`);
  } finally {
    closeHarness(harness);
  }
});

test('single Spatial add and erase compose locally over the moving 130 background', async () => {
  const source = fs.readFileSync(
    path.join(ENGINE_DIR, 'patterns', '130_spatial_paint.js'),
    'utf8',
  );
  const harness = await makeRealPatternHarness(source);
  try {
    setControl(harness.host, harness.compiled.handle, 'sliderLocalSpeed', 0.5);
    setControl(harness.host, harness.compiled.handle, 'sliderLevel', 1);
    setControl(harness.host, harness.compiled.handle, 'sliderRadius', 0.45);
    setControl(harness.host, harness.compiled.handle, 'sliderGlow', 0.3);
    setControl(harness.host, harness.compiled.handle, 'sliderTargetX', 0.5);
    setControl(harness.host, harness.compiled.handle, 'sliderTargetY', 0.5);
    setControl(harness.host, harness.compiled.handle, 'sliderDrawMode', 0);
    const background = renderHarness(harness, 0).slice();
    const targetIndex = harness.model.pixels.reduce((best, pixel, index) => {
      const distance = ((pixel.nx - 0.5) ** 2) + ((pixel.nz - 0.5) ** 2);
      return distance < best.distance ? { index, distance } : best;
    }, { index: -1, distance: Infinity }).index;
    const target = harness.model.pixels[targetIndex];
    const outsideIndex = harness.model.pixels.reduce((best, pixel, index) => {
      const distance = ((pixel.nx - target.nx) ** 2) + ((pixel.nz - target.nz) ** 2);
      return distance > best.distance ? { index, distance } : best;
    }, { index: -1, distance: -1 }).index;
    const pixels = pixelsFromBuffer(harness.model.pixels, background);
    const allPixels = Array.from({ length: pixels.length }, (_, index) => index);

    const addController = new GlobalEffectsController({
      engine: { fps: 40 },
      modelPixelCount: pixels.length,
    });
    addController.setSpatialPaint({
      enabled: true,
      mode: 'trail',
      fadeSeconds: 0.5,
      radius: 0.04,
      amount: 1,
      color: [1, 1, 1, 0, 0, 0],
      touch: true,
      targetX: target.nx,
      targetY: target.nz,
      axisX: 'nx',
      axisY: 'nz',
      pixelIndices: allPixels,
    });
    const added = background.slice();
    applyLiveTouchCreativeBuffer({
      buffer6ch: added,
      modelPixels: pixels,
      globalEffectsController: addController,
      frameIndex: 1,
      nowMs: 25,
    });
    assert.notDeepEqual(
      [...added.slice(targetIndex * 6, targetIndex * 6 + 6)],
      [...background.slice(targetIndex * 6, targetIndex * 6 + 6)],
      'one accepted contact must add over the real running background',
    );
    assert.deepEqual(
      [...added.slice(outsideIndex * 6, outsideIndex * 6 + 6)],
      [...background.slice(outsideIndex * 6, outsideIndex * 6 + 6)],
      'Spatial add must not replace or flatten the background outside the brush',
    );

    const eraseController = new GlobalEffectsController({
      engine: { fps: 40 },
      modelPixelCount: pixels.length,
    });
    eraseController.setSpatialPaint({
      enabled: true,
      mode: 'erase',
      fadeSeconds: 0.5,
      radius: 0.04,
      amount: 1,
      color: [1, 1, 1, 0, 0, 0],
      touch: true,
      targetX: target.nx,
      targetY: target.nz,
      axisX: 'nx',
      axisY: 'nz',
      pixelIndices: allPixels,
    });
    const erased = background.slice();
    applyLiveTouchCreativeBuffer({
      buffer6ch: erased,
      modelPixels: pixels,
      globalEffectsController: eraseController,
      frameIndex: 1,
      nowMs: 25,
    });
    assert.deepEqual([...erased.slice(targetIndex * 6, targetIndex * 6 + 6)], [0, 0, 0, 0, 0, 0]);
    assert.deepEqual(
      [...erased.slice(outsideIndex * 6, outsideIndex * 6 + 6)],
      [...background.slice(outsideIndex * 6, outsideIndex * 6 + 6)],
      'Spatial erase must preserve the running background outside the brush',
    );

    let moved = background;
    for (let frame = 1; frame <= 40; frame += 1) moved = renderHarness(harness, frame * 0.025);
    assert.ok(rgbRms(background, moved) > 0.1,
      'the real background clock must continue advancing underneath Spatial composition');
  } finally {
    closeHarness(harness);
  }
});

test('fixed group colors remain an explicit compositor while an empty table is transparent', async () => {
  const harness = await makeRealPatternHarness();
  try {
    const original = renderHarness(harness, 0.25);
    const modelPixels = pixelsFromBuffer(harness.model.pixels, original);
    const transparent = original.slice();
    const controller = new GlobalEffectsController({ engine: { fps: 40 } });
    applyLiveTouchCreativeBuffer({
      buffer6ch: transparent,
      modelPixels,
      globalEffectsController: controller,
      frameIndex: 10,
      nowMs: 250,
    });
    assert.deepEqual(transparent, original, 'ordinary palette output must not be repainted');

    const group = modelPixels.find(pixel => pixel.group)?.group;
    assert.ok(group, 'Titanic model must expose at least one fixture group');
    controller.setGroupFixedColor(group, [1, 0, 0, 0, 0, 0], 1);
    const explicitOwn = original.slice();
    applyLiveTouchCreativeBuffer({
      buffer6ch: explicitOwn,
      modelPixels,
      globalEffectsController: controller,
      frameIndex: 11,
      nowMs: 275,
    });
    const groupIndexes = modelPixels
      .map((pixel, index) => (pixel.group === group ? index : -1))
      .filter(index => index >= 0);
    assert.ok(groupIndexes.length > 1);
    for (const index of groupIndexes) {
      assert.deepEqual(
        [...explicitOwn.slice(index * 6, index * 6 + 6)],
        [255, 0, 0, 0, 0, 0],
        'explicit OWN paint keeps its intentional post-pattern authority',
      );
    }
  } finally {
    closeHarness(harness);
  }
});
