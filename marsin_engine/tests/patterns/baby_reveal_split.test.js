import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { WasmHost } from '../../lib/wasm_host.js';
import { buildFixtureTypeIds, fixtureTypeId } from '../../lib/fixture_type_constants.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ENGINE_DIR = path.resolve(HERE, '..', '..');
const STEP = 0.025;

async function loadPattern(name) {
  const model = await import(pathToFileURL(path.join(ENGINE_DIR, 'models', 'test_bench.js')).href);
  const host = new WasmHost();
  await host.init(model.pixels.length);
  host.setCoords(model.pixels.map(pixel => ({ nx: pixel.nx, ny: pixel.ny, nz: pixel.nz })));
  host.setPixelMeta(model.pixels.map(pixel => ({
    controllerId: pixel.cId || 0,
    sectionId: pixel.sId || 0,
    fixtureId: pixel.fId || 0,
    viewMask: pixel.vMask || 0,
    fixtureTypeId: fixtureTypeId(pixel.fixtureType),
    pixelLocalIndex: pixel.localIndex || 0,
    viewMaskHi: pixel.vMaskHi || 0,
  })));
  host.setFixtureConstants(buildFixtureTypeIds(model.pixels));
  const source = fs.readFileSync(path.join(ENGINE_DIR, 'patterns', `${name}.js`), 'utf8');
  const compiled = host.compile(source);
  assert.equal(compiled.ok, true, compiled.error);
  const handle = compiled.handle;
  const controls = new Map(host.getExports(handle)
    .filter(entry => entry.name.startsWith('slider'))
    .map(entry => [entry.name, entry.id]));
  return {
    pixels: model.pixels,
    set(control, value) {
      assert.ok(controls.has(control), `missing ${control}`);
      host.setControl(handle, controls.get(control), value);
    },
    render(elapsed) {
      host.beginFrame(handle, elapsed);
      return Uint8Array.from(
        host.renderAll6ch(handle, new Uint8Array(model.pixels.length * 6)),
      );
    },
    close() {
      host.destroy(handle);
      host.shutdown();
    },
  };
}

function census(frame, pixels) {
  let pink = 0;
  let blue = 0;
  let white = 0;
  let energy = 0;
  for (let index = 0; index < pixels.length; index += 1) {
    const offset = index * 6;
    const [r, g, b, w, a, u] = frame.subarray(offset, offset + 6);
    assert.equal(w, a, `pixel ${index}: W/A mismatch`);
    assert.equal(u, 0, `pixel ${index}: UV escaped`);
    if (w > 0) {
      assert.equal(fixtureTypeId(pixels[index].fixtureType), 3,
        `pixel ${index}: white escaped Vintage`);
      white += 1;
    }
    energy += r + g + b + w + a;
    if (Math.max(r, g, b) < 6) continue;
    if (r > b * 1.55 && b > g * 2.5) pink += 1;
    else if (b > g * 1.55 && g > r * 3.0) blue += 1;
    else assert.fail(`pixel ${index}: forbidden family ${r},${g},${b}`);
  }
  return { pink, blue, white, energy };
}

function sideCensus(frame, pixels) {
  const sides = {
    left: { pink: 0, blue: 0 },
    right: { pink: 0, blue: 0 },
  };
  for (let index = 0; index < pixels.length; index += 1) {
    const offset = index * 6;
    const [r, g, b] = frame.subarray(offset, offset + 3);
    if (Math.max(r, g, b) < 6) continue;
    const side = pixels[index].nx < 0.5 ? sides.left : sides.right;
    if (r > b * 1.55 && b > g * 2.5) side.pink += 1;
    else if (b > g * 1.55 && g > r * 3.0) side.blue += 1;
  }
  return sides;
}

function whiteCensus(frame, pixels) {
  let lit = 0;
  let energy = 0;
  for (let index = 0; index < pixels.length; index += 1) {
    const offset = index * 6;
    const [r, g, b, w, a, u] = frame.subarray(offset, offset + 6);
    assert.equal(w, a, `pixel ${index}: W/A mismatch`);
    assert.equal(u, 0, `pixel ${index}: UV escaped`);
    energy += r + g + b + w + a;
    if (Math.max(r, g, b, w, a) === 0) continue;
    assert.equal(r, g, `pixel ${index}: white flash R/G mismatch`);
    assert.equal(g, b, `pixel ${index}: white flash G/B mismatch`);
    assert.equal(b, w, `pixel ${index}: white flash RGB/W mismatch`);
    lit += 1;
  }
  return { lit, energy };
}

async function sampleTimeline(pattern, times) {
  const wanted = new Map(times.map(time => [Math.round(time / STEP), time]));
  const samples = new Map();
  const end = Math.max(...wanted.keys());
  for (let frame = 0; frame <= end; frame += 1) {
    const output = pattern.render(frame * STEP);
    if (wanted.has(frame)) samples.set(wanted.get(frame), output);
  }
  return samples;
}

test('baby tease is outcome-blind, chaptered, and holds indefinite blackout', async () => {
  const pattern = await loadPattern('132_baby_tease');
  try {
    pattern.set('sliderLocalSpeed', 0.32);
    pattern.set('sliderLevel', 0.90);
    pattern.set('sliderSpatialDepth', 0.72);
    pattern.set('sliderSparkle', 0.58);
    pattern.set('sliderReplayFinale', 0);
    pattern.set('sliderRestartTease', 1);
    const times = [1, 3.5, 61.5, 64.5, 67.5, 70.5,
      120.1, 120.9, 121.6, 122.4, 150.2, 151, 151.8, 158.5, 170];
    const samples = await sampleTimeline(pattern, times);

    const pinkHeavy = census(samples.get(1), pattern.pixels);
    const blueHeavy = census(samples.get(3.5), pattern.pixels);
    assert.ok(pinkHeavy.pink > 0 && pinkHeavy.blue > 0,
      `pink-heavy rounds must retain blue: ${JSON.stringify(pinkHeavy)}`);
    assert.ok(pinkHeavy.pink > pinkHeavy.blue * 2,
      'pink-heavy rounds must visibly favor pink');
    assert.ok(blueHeavy.pink > 0 && blueHeavy.blue > 0,
      'blue-heavy rounds must retain pink');
    assert.ok(blueHeavy.blue > blueHeavy.pink * 2,
      'blue-heavy rounds must visibly favor blue');

    for (const time of [61.5, 64.5, 67.5, 70.5]) {
      const mixed = census(samples.get(time), pattern.pixels);
      assert.ok(mixed.pink > 0 && mixed.blue > 0,
        `${time}s scarcity swing must never fully remove either family`);
    }
    const firstSwing = sideCensus(samples.get(61.5), pattern.pixels);
    const secondSwing = sideCensus(samples.get(64.5), pattern.pixels);
    assert.ok(firstSwing.left.pink > firstSwing.left.blue * 3,
      'first scarcity swing must make blue minimal on the left');
    assert.ok(secondSwing.right.blue > secondSwing.right.pink * 3,
      'second scarcity swing must make pink minimal on the right');

    const pinkFlash = census(samples.get(120.1), pattern.pixels);
    const allFlashA = census(samples.get(120.9), pattern.pixels);
    const blueFlash = census(samples.get(121.6), pattern.pixels);
    const allFlashB = census(samples.get(122.4), pattern.pixels);
    assert.ok(pinkFlash.pink > 0 && pinkFlash.blue === 0, 'flash order starts pink');
    assert.ok(allFlashA.pink > 0 && allFlashA.blue > 0, 'pink is followed by all');
    assert.ok(blueFlash.blue > 0 && blueFlash.pink === 0, 'all is followed by blue');
    assert.ok(allFlashB.pink > 0 && allFlashB.blue > 0, 'blue is followed by all');

    const whiteOnA = whiteCensus(samples.get(150.2), pattern.pixels);
    const whiteOff = whiteCensus(samples.get(151), pattern.pixels);
    const whiteOnB = whiteCensus(samples.get(151.8), pattern.pixels);
    assert.equal(whiteOnA.lit, pattern.pixels.length, 'white finale must hit the whole rig');
    assert.equal(whiteOff.energy, 0, 'white finale needs crisp black gaps');
    assert.equal(whiteOnB.lit, pattern.pixels.length, 'white finale must repeat');
    assert.equal(whiteCensus(samples.get(158.5), pattern.pixels).energy, 0);
    assert.equal(whiteCensus(samples.get(170), pattern.pixels).energy, 0,
      'tease must stay black until a different playlist is manually pushed');

    pattern.set('sliderReplayFinale', 1);
    const replay = pattern.render(170.025);
    const replayStart = census(replay, pattern.pixels);
    assert.ok(replayStart.pink > 0 && replayStart.blue === 0,
      'Replay Finale must jump back to the 120-second pink flash');
    pattern.set('sliderReplayFinale', 0);
  } finally {
    pattern.close();
  }
});

test('manual girl and boy reveal entries start with an explosion and hold one family', async () => {
  const pattern = await loadPattern('133_baby_reveal_burst');
  try {
    pattern.set('sliderLevel', 0.90);
    pattern.set('sliderSpatialDepth', 0.72);
    pattern.set('sliderSparkle', 0.58);
    pattern.set('sliderFinalColor', 0);
    const pink = await sampleTimeline(pattern, [0, 0.5, 3]);
    assert.equal(census(pink.get(0), pattern.pixels).energy, 0, 'manual reveal starts at black');
    const pinkBurst = census(pink.get(0.5), pattern.pixels);
    const pinkHold = census(pink.get(3), pattern.pixels);
    assert.ok(pinkBurst.pink > 0 && pinkBurst.blue === 0 && pinkBurst.white > 0);
    assert.ok(pinkHold.pink > 0 && pinkHold.blue === 0);

    pattern.set('sliderFinalColor', 1);
    pattern.set('sliderRestartReveal', 1);
    const blue = await sampleTimeline(pattern, [0, 0.5, 3]);
    const blueBurst = census(blue.get(0.5), pattern.pixels);
    const blueHold = census(blue.get(3), pattern.pixels);
    assert.ok(blueBurst.blue > 0 && blueBurst.pink === 0 && blueBurst.white > 0);
    assert.ok(blueHold.blue > 0 && blueHold.pink === 0);
  } finally {
    pattern.close();
  }
});
