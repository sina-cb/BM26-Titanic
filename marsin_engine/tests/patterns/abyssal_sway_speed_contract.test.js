import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { loadModelForGauge } from '../../lib/model_loader.js';
import { WasmHost } from '../../lib/wasm_host.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ENGINE_DIR = path.resolve(HERE, '..', '..');
const PATTERN_FILE = path.join(ENGINE_DIR, 'patterns', '22_abyssal_sway_garden.js');
const INTERNAL_DT = 0.025;
const GLOBAL_SPEED_MAX = 4.0;

function setControl(host, handle, name, value) {
  const control = host.getExports(handle).find((entry) => entry.name === name);
  assert.ok(control, `missing ${name}`);
  host.setControl(handle, control.id, value);
}

function adjacentRgbRms(left, right) {
  let sumSquares = 0;
  let samples = 0;
  for (let offset = 0; offset < left.length; offset += 6) {
    for (let channel = 0; channel < 3; channel += 1) {
      const difference = right[offset + channel] - left[offset + channel];
      sumSquares += difference * difference;
      samples += 1;
    }
  }
  return Math.sqrt(sumSquares / samples);
}

test('abyssal sway stays continuous at maximum global and local speed', async () => {
  const loaded = await loadModelForGauge('titanic');
  const host = new WasmHost();
  let compiled = null;
  try {
    await host.init(loaded.pixels.length);
    host.setCoords(loaded.pixels.map((pixel) => ({
      nx: pixel.nx,
      ny: pixel.ny,
      nz: pixel.nz,
    })));
    host.setPixelMeta(loaded.metaArray);
    host.setFixtureConstants(loaded.fixtureConstants);

    compiled = host.compile(fs.readFileSync(PATTERN_FILE, 'utf8'));
    assert.equal(compiled.ok, true, compiled.error);

    setControl(host, compiled.handle, 'sliderLocalSpeed', 1.0);
    setControl(host, compiled.handle, 'sliderLevel', 0.22);
    setControl(host, compiled.handle, 'sliderKick', 0.0);
    setControl(host, compiled.handle, 'sliderRadius', 1.0);
    setControl(host, compiled.handle, 'sliderDetail', 0.86);
    setControl(host, compiled.handle, 'sliderFrondDensity', 0.68);
    setControl(host, compiled.handle, 'sliderTipGlow', 0.34);
    setControl(host, compiled.handle, 'sliderBaseDarkness', 0.68);

    const work = new Uint8Array(loaded.pixels.length * 6);
    const frames = [];
    for (let step = 0; step < 160; step += 1) {
      host.beginFrame(compiled.handle, step * INTERNAL_DT * GLOBAL_SPEED_MAX);
      if (step % 2 === 1) {
        frames.push(host.renderAll6ch(compiled.handle, work).slice());
      }
    }

    const changes = [];
    for (let frame = 1; frame < frames.length; frame += 1) {
      changes.push(adjacentRgbRms(frames[frame - 1], frames[frame]));
    }
    const meanChange = changes.reduce((sum, value) => sum + value, 0) / changes.length;
    const maxChange = Math.max(...changes);

    assert.ok(meanChange <= 23,
      `maximum-speed mean adjacent RGB RMS ${meanChange.toFixed(3)} exceeds 23`);
    assert.ok(maxChange <= 33,
      `maximum-speed peak adjacent RGB RMS ${maxChange.toFixed(3)} exceeds 33`);
  } finally {
    if (compiled?.ok) host.destroy(compiled.handle);
    host.shutdown();
  }
});
