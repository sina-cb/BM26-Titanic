import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

import { WasmHost } from '../../lib/wasm_host.js';
import {
  buildFixtureTypeIds,
  fixtureTypeId,
} from '../../lib/fixture_type_constants.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENGINE_DIR = path.resolve(__dirname, '../..');
const PATTERN_FILE = path.join(ENGINE_DIR, 'patterns', '131_baby_reveal.js');
const STEP_SECONDS = 0.025;

async function createPattern() {
  const model = await import(pathToFileURL(
    path.join(ENGINE_DIR, 'models', 'test_bench.js')).href);
  const pixels = model.pixels;
  const host = new WasmHost();
  await host.init(pixels.length);
  host.setCoords(pixels.map(pixel => ({
    nx: pixel.nx,
    ny: pixel.ny,
    nz: pixel.nz,
  })));
  host.setPixelMeta(pixels.map(pixel => ({
    controllerId: pixel.cId || 0,
    sectionId: pixel.sId || 0,
    fixtureId: pixel.fId || 0,
    viewMask: pixel.vMask || 0,
    fixtureTypeId: fixtureTypeId(pixel.fixtureType),
    pixelLocalIndex: pixel.localIndex || 0,
    viewMaskHi: pixel.vMaskHi || 0,
  })));
  host.setFixtureConstants(buildFixtureTypeIds(pixels));

  const source = fs.readFileSync(PATTERN_FILE, 'utf8');
  const compiled = host.compile(source);
  assert.equal(compiled.ok, true, compiled.error);
  const handle = compiled.handle;
  const controls = new Map(
    host.getExports(handle)
      .filter(entry => entry.name.startsWith('slider'))
      .map(entry => [entry.name, entry.id]),
  );

  function set(name, value) {
    assert.ok(controls.has(name), `missing ${name}`);
    host.setControl(handle, controls.get(name), value);
  }

  function renderAt(elapsedSeconds) {
    host.beginFrame(handle, elapsedSeconds);
    return host.renderAll6ch(
      handle,
      new Uint8Array(pixels.length * 6),
    ).slice();
  }

  function close() {
    host.destroy(handle);
    host.shutdown();
  }

  return { pixels, set, renderAt, close };
}

function channelMeans(frame, pixelCount) {
  let r = 0;
  let g = 0;
  let b = 0;
  let w = 0;
  let a = 0;
  let u = 0;
  for (let index = 0; index < pixelCount; index += 1) {
    const offset = index * 6;
    r += frame[offset];
    g += frame[offset + 1];
    b += frame[offset + 2];
    w += frame[offset + 3];
    a += frame[offset + 4];
    u += frame[offset + 5];
  }
  return {
    r: r / pixelCount,
    g: g / pixelCount,
    b: b / pixelCount,
    w: w / pixelCount,
    a: a / pixelCount,
    u: u / pixelCount,
  };
}

function assertStrictEventColours(frame, pixels, expectedFamily = null) {
  let pinkPixels = 0;
  let bluePixels = 0;
  let jewelryWhitePixels = 0;
  for (let index = 0; index < pixels.length; index += 1) {
    const offset = index * 6;
    const r = frame[offset];
    const g = frame[offset + 1];
    const b = frame[offset + 2];
    const w = frame[offset + 3];
    const a = frame[offset + 4];
    const u = frame[offset + 5];
    assert.equal(a, w, `pixel ${index}: W/A mismatch`);
    assert.equal(u, 0, `pixel ${index}: UV is forbidden`);
    if (w > 0) {
      assert.equal(
        fixtureTypeId(pixels[index].fixtureType),
        3,
        `pixel ${index}: native white escaped Vintage Jewelry`,
      );
      jewelryWhitePixels += 1;
    }
    if (Math.max(r, g, b) < 6) continue;
    const isPink = r > b * 1.55 && b > g * 2.5;
    const isBlue = b > g * 1.55 && g > r * 3.0;
    assert.ok(isPink || isBlue, `pixel ${index}: forbidden RGB ${r},${g},${b}`);
    if (isPink) pinkPixels += 1;
    if (isBlue) bluePixels += 1;
  }
  if (expectedFamily === 'pink') {
    assert.ok(pinkPixels > 0, 'expected visible pink-family pixels');
    assert.equal(bluePixels, 0, 'pink frame must contain no blue-family pixels');
  } else if (expectedFamily === 'blue') {
    assert.ok(bluePixels > 0, 'expected visible blue-family pixels');
    assert.equal(pinkPixels, 0, 'blue frame must contain no pink-family pixels');
  }
  return { pinkPixels, bluePixels, jewelryWhitePixels };
}

async function advance(pattern, endSeconds, sampleTimes = []) {
  const samples = new Map();
  const wanted = new Set(sampleTimes.map(time => Math.round(time / STEP_SECONDS)));
  const endFrame = Math.round(endSeconds / STEP_SECONDS);
  let earlyState = null;
  let lateState = null;
  let earlyTransitions = 0;
  let lateTransitions = 0;
  for (let frameIndex = 0; frameIndex <= endFrame; frameIndex += 1) {
    const frame = pattern.renderAt(frameIndex * STEP_SECONDS);
    let means = null;
    if (wanted.has(frameIndex)) {
      means = channelMeans(frame, pattern.pixels.length);
      samples.set(frameIndex, { means, frame });
    }
    if (frameIndex % 4 === 0) {
      const seconds = frameIndex * STEP_SECONDS;
      if (seconds <= 10.0 || (seconds >= 80.0 && seconds < 90.0)) {
        if (!means) means = channelMeans(frame, pattern.pixels.length);
        const state = means.b > means.r;
        if (seconds <= 10.0) {
          if (earlyState !== null && state !== earlyState) earlyTransitions += 1;
          earlyState = state;
        } else {
          if (lateState !== null && state !== lateState) lateTransitions += 1;
          lateState = state;
        }
      }
    }
  }
  return { samples, earlyTransitions, lateTransitions };
}

test('baby reveal follows tease, exact blackout, final colour, and reset contract', async () => {
  const pattern = await createPattern();
  try {
    pattern.set('sliderLocalSpeed', 0.32);
    pattern.set('sliderFinalColor', 0.0);
    pattern.set('sliderLevel', 0.90);
    pattern.set('sliderSpatialDepth', 0.62);
    pattern.set('sliderSparkle', 0.42);
    pattern.set('sliderRestartReveal', 0.0);

    const pinkRun = await advance(pattern, 93.0,
      [1.0, 16.0, 35.0, 52.0, 70.0, 84.0, 89.0, 90.5, 91.5, 92.75]);
    const earlyPinkSample = pinkRun.samples.get(Math.round(1.0 / STEP_SECONDS));
    const earlyBlueSample = pinkRun.samples.get(Math.round(16.0 / STEP_SECONDS));
    const dualitySample = pinkRun.samples.get(Math.round(35.0 / STEP_SECONDS));
    const cellularSample = pinkRun.samples.get(Math.round(52.0 / STEP_SECONDS));
    const helixSample = pinkRun.samples.get(Math.round(70.0 / STEP_SECONDS));
    const accelerationSample = pinkRun.samples.get(Math.round(84.0 / STEP_SECONDS));
    const barrageSample = pinkRun.samples.get(Math.round(89.0 / STEP_SECONDS));
    const noLeakPink = dualitySample;
    const blackoutASample = pinkRun.samples.get(Math.round(90.5 / STEP_SECONDS));
    const blackoutBSample = pinkRun.samples.get(Math.round(91.5 / STEP_SECONDS));
    const finalPinkSample = pinkRun.samples.get(Math.round(92.75 / STEP_SECONDS));
    const earlyPink = earlyPinkSample.means;
    const earlyBlue = earlyBlueSample.means;
    const blackoutA = blackoutASample.means;
    const blackoutB = blackoutBSample.means;
    const finalPink = finalPinkSample.means;

    assert.ok(earlyPink.r > earlyPink.b * 2.0, 'opening must be visibly pink');
    assert.ok(earlyBlue.b > earlyBlue.r * 2.0, 'tease must alternate to blue');
    assertStrictEventColours(earlyPinkSample.frame, pattern.pixels, 'pink');
    assertStrictEventColours(earlyBlueSample.frame, pattern.pixels, 'blue');
    for (const [name, sample] of [
      ['spatial duality', dualitySample],
      ['cellular chase', cellularSample],
      ['helix duel', helixSample],
    ]) {
      const contract = assertStrictEventColours(sample.frame, pattern.pixels);
      assert.ok(contract.pinkPixels > 0, `${name} must visibly contain pink`);
      assert.ok(contract.bluePixels > 0, `${name} must visibly contain blue`);
    }
    assertStrictEventColours(accelerationSample.frame, pattern.pixels);
    assertStrictEventColours(barrageSample.frame, pattern.pixels);
    assert.deepEqual(blackoutA, { r: 0, g: 0, b: 0, w: 0, a: 0, u: 0 });
    assert.deepEqual(blackoutB, { r: 0, g: 0, b: 0, w: 0, a: 0, u: 0 });
    assert.ok(finalPink.r > finalPink.b * 2.0, 'pink answer must remain pink');
    const finalPinkContract = assertStrictEventColours(
      finalPinkSample.frame, pattern.pixels, 'pink');
    assert.ok(finalPinkContract.jewelryWhitePixels > 0,
      'final scene should include Vintage-only diamond white');
    assert.ok(pinkRun.earlyTransitions <= 1,
      `opening prophecy must remain calm: transitions=${pinkRun.earlyTransitions}`);
    assert.ok(pinkRun.lateTransitions >= 18,
      `final question must accelerate strongly: transitions=${pinkRun.lateTransitions}`);

    pattern.set('sliderFinalColor', 1.0);
    pattern.set('sliderRestartReveal', 1.0);
    const restarted = pattern.renderAt(0.0);
    const restartedMean = channelMeans(restarted, pattern.pixels.length);
    assert.ok(
      restartedMean.r > restartedMean.b * 2.0,
      'restart must return to the opening pink tease, not skip to the answer',
    );

    const blueRun = await advance(pattern, 93.0, [35.0, 92.75]);
    const noLeakBlue = blueRun.samples.get(Math.round(35.0 / STEP_SECONDS));
    const finalBlueSample = blueRun.samples.get(Math.round(92.75 / STEP_SECONDS));
    const finalBlue = finalBlueSample.means;
    assert.deepEqual(noLeakBlue.frame, noLeakPink.frame,
      'Final Color must not alter any pre-reveal frame');
    assert.ok(finalBlue.b > finalBlue.r * 2.0, 'blue answer must remain blue');
    const finalBlueContract = assertStrictEventColours(
      finalBlueSample.frame, pattern.pixels, 'blue');
    assert.ok(finalBlueContract.jewelryWhitePixels > 0,
      'blue final should retain Vintage-only diamond white');
  } finally {
    pattern.close();
  }
});
