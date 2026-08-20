// baby_tease_redesign_metrics.test.js — the two offline metrics introduced by
// the Baby Tease redesign (docs/72 §2.3 "L2" and §9), kept separate from
// baby_color_contract.test.js because they measure ART DIRECTION rather than
// the show's colour safety.
//
//   L2 — ANTI-BILATERAL PREDICTABILITY. The defect the redesign exists to fix
//   was mechanical, not tasteful: twelve of the previous fifteen tease looks
//   computed `field = (linear plane in the ship frame) + small sinusoids` and
//   thresholded at zero, so every one of them read as "one half blue, one half
//   pink, wiggly seam" at fifty feet. A perturbation can bend that seam but can
//   never move territory across it. This test measures exactly that: for each
//   axis, how well does a pixel's position on one side of the midline predict
//   which family owns it? The killed set scores 0.9-1.0 on its split axis. A
//   genuinely mixed field — periodic, cellular, angular, radial, laned or
//   multi-body — scores near zero, because both families appear on both halves.
//
//   §9 — PERCEIVED BALANCE. Rec.709 luma says unit-drive pink (0.264) is much
//   darker than unit-drive blue (0.401), but the red-saturated pink family
//   gains strongly from the Helmholtz-Kohlrausch effect at night and, per the
//   operator's field observation (the ground truth here), visibly DOMINATES the
//   LED bars. The weights below encode that. The check keeps the two families
//   at equal perceived authority using the ONLY two balance knobs in the set —
//   `PINK_TRIM` and `PINK_BAR_TRIM` in each pattern's authority block. The
//   per-pattern pink-gain zoo this replaced (×1.02 … ×9 on bars) is what made
//   the old set impossible to balance globally.
//
// Both metrics run on the same offline capture path as the colour contract: the
// real model compiler, no sockets, no engine, no show ports.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadModelForGauge } from '../../lib/model_loader.js';
import { WasmHost } from '../../lib/wasm_host.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ENGINE_DIR = path.resolve(HERE, '..', '..');
const PATTERNS_DIR = path.join(ENGINE_DIR, 'patterns');
// The tease lives in its OWN top-level family directory, numbered 01-13 in
// playlist order (see baby_color_contract.test.js for why it is a sibling of
// patterns/baby/ rather than a subdirectory of it).
const TEASE_DIR = 'baby_tease';
const MODELS = ['titanic', 'test_bench'];

// The measured smokestack frame — identical to the constants every tease
// pattern declares, and asserted against them by baby_color_contract.
const SHIP_CENTER_X = 0.5219458333333333;
const SHIP_CENTER_Z = 0.5606541666666667;
const SHIP_AXIS_X = 0.7658426753447269;
const SHIP_AXIS_Z = -0.6430279905422711;

// docs/72 §2 L2 thresholds.
const MAX_MEAN_PREDICTABILITY = 0.35;
const MAX_PEAK_PREDICTABILITY = 0.65;

// docs/72 §9 perceived weights and acceptance window.
const W_PINK = 0.46;
const W_BLUE = 0.42;
const MIN_BALANCE = 0.90;
const MAX_BALANCE = 1.11;

const PINK = [1.000, 0.035, 0.360];
const BLUE = [0.033, 0.450, 1.000];

const TEASE_IDS = JSON.parse(fs.readFileSync(path.join(PATTERNS_DIR, 'manifest.json'), 'utf8'))
  .filter((id) => id.startsWith(`${TEASE_DIR}/`));

function matchesScaledColour(r, g, b, base) {
  const peak = Math.max(r, g, b);
  return Math.abs(r - base[0] * peak) <= 2
    && Math.abs(g - base[1] * peak) <= 2
    && Math.abs(b - base[2] * peak) <= 2;
}

const MODEL_CACHE = new Map();
async function model(name) {
  if (!MODEL_CACHE.has(name)) MODEL_CACHE.set(name, await loadModelForGauge(name));
  return MODEL_CACHE.get(name);
}

async function compilePattern(id, modelName) {
  const loaded = await model(modelName);
  const host = new WasmHost();
  await host.init(loaded.pixels.length);
  host.setCoords(loaded.pixels.map((pixel) => ({ nx: pixel.nx, ny: pixel.ny, nz: pixel.nz })));
  host.setPixelMeta(loaded.metaArray);
  host.setFixtureConstants(loaded.fixtureConstants);
  const source = fs.readFileSync(path.join(PATTERNS_DIR, `${id}.js`), 'utf8');
  const result = host.compile(source);
  assert.equal(result.ok, true, `${id} on ${modelName}: ${result.error}`);
  const frame = new Uint8Array(loaded.pixels.length * 6);
  return {
    loaded,
    render(elapsed) {
      host.beginFrame(result.handle, elapsed);
      return Uint8Array.from(host.renderAll6ch(result.handle, frame));
    },
    close() { host.destroy(result.handle); host.shutdown(); },
  };
}

// Patterns clamp a single large beforeRender delta on purpose, so a capture has
// to be stepped at the real frame rate rather than jumped to.
function captureSeconds(pattern, seconds, step = 0.025) {
  const wanted = new Map();
  const ticks = seconds.map((second) => Math.round(second / step));
  const last = Math.max(...ticks);
  const set = new Set(ticks);
  for (let tick = 0; tick <= last; tick++) {
    const frame = pattern.render(tick * step);
    if (set.has(tick)) wanted.set(tick, frame);
  }
  return ticks.map((tick) => wanted.get(tick));
}

/** ±1 half-space labels per pixel for the three review axes. */
function axisLabels(loaded) {
  const shipLong = new Int8Array(loaded.pixels.length);
  const vertical = new Int8Array(loaded.pixels.length);
  const shipWide = new Int8Array(loaded.pixels.length);
  for (let index = 0; index < loaded.pixels.length; index++) {
    const pixel = loaded.pixels[index];
    const dx = pixel.nx - SHIP_CENTER_X;
    const dz = pixel.nz - SHIP_CENTER_Z;
    shipLong[index] = (0.5 + dx * SHIP_AXIS_X + dz * SHIP_AXIS_Z) >= 0.5 ? 1 : -1;
    vertical[index] = pixel.ny >= 0.5 ? 1 : -1;
    shipWide[index] = (0.5 - dx * SHIP_AXIS_Z + dz * SHIP_AXIS_X) >= 0.5 ? 1 : -1;
  }
  return { shipLong, y: vertical, shipWide };
}

// A 30-second review on a half-second grid (61 samples), not 21 one-second
// samples. Both metrics here are TIME AVERAGES, and a time average is only
// meaningful when the window covers whole cycles of the thing being averaged.
// The tease speed retune (report _305) moved the fastest keeper's cycle to
// about 4 s, so a 21-second window weighted a partial cycle heavily enough to
// swing `13_position_swap`'s perceived balance to 1.132 — while the SAME source
// measured 1.071 here and its PRE-retune ancestor measured 1.086 over a 600 s
// window. The old window was reporting its own truncation. Denser and longer
// costs a few seconds of test time and converges instead.
const REVIEW_SECONDS = Array.from({ length: 61 }, (_, half) => half * 0.5);

test('no Tease keeper is bilaterally predictable on any ship axis (docs/72 L2)', async () => {
  for (const modelName of MODELS) {
    for (const id of TEASE_IDS) {
      const pattern = await compilePattern(id, modelName);
      try {
        const labels = axisLabels(pattern.loaded);
        const frames = captureSeconds(pattern, REVIEW_SECONDS);
        const totals = { shipLong: 0, y: 0, shipWide: 0 };
        const peaks = { shipLong: 0, y: 0, shipWide: 0 };
        for (const frame of frames) {
          const pixels = frame.length / 6;
          for (const axis of ['shipLong', 'y', 'shipWide']) {
            let agreement = 0;
            let owned = 0;
            for (let pixel = 0; pixel < pixels; pixel++) {
              const offset = pixel * 6;
              const r = frame[offset];
              const g = frame[offset + 1];
              const b = frame[offset + 2];
              if (Math.max(r, g, b) < 6) continue;
              let owner = 0;
              if (matchesScaledColour(r, g, b, PINK)) owner = 1;
              else if (matchesScaledColour(r, g, b, BLUE)) owner = -1;
              else continue;
              agreement += owner * labels[axis][pixel];
              owned++;
            }
            const predictability = owned === 0 ? 0 : Math.abs(agreement / owned);
            totals[axis] += predictability;
            peaks[axis] = Math.max(peaks[axis], predictability);
          }
        }
        for (const axis of ['shipLong', 'y', 'shipWide']) {
          const mean = totals[axis] / frames.length;
          assert.ok(mean <= MAX_MEAN_PREDICTABILITY,
            `${id} on ${modelName}: ${axis} half-space predicts the family ` +
            `${mean.toFixed(3)} of the time (max ${MAX_MEAN_PREDICTABILITY}) — ` +
            'this is the left/right split the redesign removed');
          assert.ok(peaks[axis] <= MAX_PEAK_PREDICTABILITY,
            `${id} on ${modelName}: ${axis} predictability peaks at ` +
            `${peaks[axis].toFixed(3)} (max ${MAX_PEAK_PREDICTABILITY})`);
        }
      } finally {
        pattern.close();
      }
    }
  }
});

test('every Tease keeper holds equal PERCEIVED pink/blue authority (docs/72 §9)', async () => {
  for (const modelName of MODELS) {
    for (const id of TEASE_IDS) {
      const pattern = await compilePattern(id, modelName);
      try {
        const frames = captureSeconds(pattern, REVIEW_SECONDS);
        let total = 0;
        for (const frame of frames) {
          let pink = 0;
          let blue = 0;
          for (let pixel = 0; pixel < frame.length / 6; pixel++) {
            const offset = pixel * 6;
            const r = frame[offset];
            const g = frame[offset + 1];
            const b = frame[offset + 2];
            const peak = Math.max(r, g, b);
            if (peak < 6) continue;
            if (matchesScaledColour(r, g, b, PINK)) pink += peak * W_PINK;
            else if (matchesScaledColour(r, g, b, BLUE)) blue += peak * W_BLUE;
          }
          assert.ok(blue > 0, `${id} on ${modelName}: no blue energy in a review frame`);
          total += pink / blue;
        }
        const balance = total / frames.length;
        assert.ok(balance >= MIN_BALANCE && balance <= MAX_BALANCE,
          `${id} on ${modelName}: perceived pink/blue authority ${balance.toFixed(3)} ` +
          `is outside ${MIN_BALANCE}-${MAX_BALANCE}. Retune PINK_TRIM / PINK_BAR_TRIM ` +
          'globally (docs/72 D2) — never with a per-pattern gain.');
      } finally {
        pattern.close();
      }
    }
  }
});

// The authority block is the whole point of the redesign: one law, two knobs,
// applied identically everywhere. A per-pattern gain reintroduced by a later
// edit would pass both metrics above on its own file while making the set
// impossible to balance from one place again — so pin the constants by source.
test('every Tease keeper carries the identical canonical authority block', () => {
  const seen = new Map();
  for (const id of TEASE_IDS) {
    const source = fs.readFileSync(path.join(PATTERNS_DIR, `${id}.js`), 'utf8');
    for (const name of ['PINK_TRIM', 'PINK_BAR_TRIM', 'FLOOR_I']) {
      const matches = [...source.matchAll(new RegExp(`var\\s+${name}\\s*=\\s*(-?[0-9.]+)\\s*;`, 'g'))];
      assert.equal(matches.length, 1,
        `${id}: expected exactly one ${name} declaration, found ${matches.length}`);
      const value = matches[0][1];
      if (!seen.has(name)) seen.set(name, { value, id });
      assert.equal(value, seen.get(name).value,
        `${id}: ${name} is ${value} but ${seen.get(name).id} uses ` +
        `${seen.get(name).value} — the authority block must be identical across the set`);
    }
  }
});
