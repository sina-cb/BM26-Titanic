/**
 * spotlight_sampling.test.js — the SpotLight sampling strategies: semantics
 * preserved for the ones that shipped, churn bounded for the ones added.
 *
 * Two jobs:
 *
 *   1. PIN THE OLD BEHAVIOUR. `closest`, `closest_bucket` and `uniform` were
 *      re-implemented for cost (squared-distance window test, contiguous-prefix
 *      bucket scan, a provably no-op sort deleted, no per-frame allocation).
 *      Every one of those is claimed to be output-identical, so this file
 *      carries a verbatim copy of the ORIGINAL selector and asserts identity of
 *      the chosen request sets over hundreds of deterministic random inputs.
 *      The one deliberate difference is called out and tested: `closest` used
 *      to be UNREACHABLE — the resolver silently mapped it (and every unknown
 *      value) onto `uniform`.
 *
 *   2. MEASURE THE FLICKER. A synthetic ship with a travelling brightness wave
 *      is run for hundreds of frames through each strategy, and pool
 *      reassignments are counted. That number IS the flicker: every
 *      reassignment under the old strategies is a light popping out and another
 *      popping in, within one frame.
 *
 * Offline: no browser, no ports, no scene writes, no live processes.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import {
  COVERAGE_GRID_DIVISIONS,
  DEFAULT_SPOTLIGHT_SAMPLING_MODE,
  IMPORTANCE_BRIGHTNESS_FLOOR,
  ROTATION_FADE_FRAMES,
  ROTATION_MEMORY_FRAMES,
  ROTATION_PERIOD_FRAMES,
  ROTATION_WARMUP_PERIOD_FRAMES,
  SPOTLIGHT_SAMPLING_MODES,
  STABLE_FADE_FRAMES,
  STABLE_HYSTERESIS_FRAMES,
  STABLE_HYSTERESIS_MARGIN,
  STABLE_MAX_FILLS_PER_FRAME,
  STABLE_MAX_HANDOFFS_PER_FRAME,
  assertSpotlightSamplingMode,
  createSpotlightPlanner,
  isLegacySpotlightSamplingMode,
  resolveSpotlightSamplingMode,
  sampleUniformRequests,
  selectLegacySample,
} from '../src/core/spotlight_sampling.js';
import { extractParams } from '../src/core/config.js';
import { params, setModelRadius, setScene } from '../src/core/state.js';

const MIN_ANALYTIC_LIGHT_LUMINANCE = 1 / 255;

// ── The ORIGINAL selector, verbatim ─────────────────────────────────────
// Copied from light_pool.js as it stood before this work (git 9e8b23b8), minus
// the `params` reads, so the optimized implementation can be diffed against the
// behaviour that actually shipped.

function originalSampleUniformRequests(sortedRequests, sampleCount) {
  if (sampleCount <= 0 || sortedRequests.length === 0) return [];
  if (sortedRequests.length <= sampleCount) return sortedRequests;
  if (sampleCount === 1) return [sortedRequests[sortedRequests.length - 1]];

  const selected = [];
  for (let i = 0; i < sampleCount; i++) {
    const start = Math.floor((i * sortedRequests.length) / sampleCount);
    const end = Math.max(start, Math.floor(((i + 1) * sortedRequests.length) / sampleCount) - 1);
    const midpoint = Math.floor((start + end) / 2);
    selected.push(sortedRequests[midpoint]);
  }
  return selected;
}

function originalSelect(samplingMode, visible, activeLimit, bucketDistance) {
  if (activeLimit <= 0 || visible.length === 0) return [];

  if (samplingMode === 'closest') {
    return visible.slice(0, activeLimit);
  }
  if (samplingMode === 'uniform') {
    return originalSampleUniformRequests(visible, activeLimit);
  }

  const closestRequest = visible[0];
  const closestDistance = Math.sqrt(closestRequest.distSq);
  if (closestDistance <= 0) {
    return visible.slice(0, activeLimit);
  }

  const bucketMin = closestDistance;
  const bucketMax = closestDistance + bucketDistance;

  const bucketRequests = [];
  for (const req of visible) {
    const distance = Math.sqrt(req.distSq);
    if (distance >= bucketMin && distance <= bucketMax) {
      req.bucketDepth = distance;
      bucketRequests.push(req);
    }
  }

  if (bucketRequests.length === 0) {
    return visible.slice(0, activeLimit);
  }

  bucketRequests.sort((a, b) => {
    if (a.bucketDepth !== b.bucketDepth) return a.bucketDepth - b.bucketDepth;
    return a.distSq - b.distSq;
  });

  return originalSampleUniformRequests(bucketRequests, Math.min(activeLimit, bucketRequests.length));
}

// ── Deterministic synthetic world ───────────────────────────────────────
// A mulberry32 PRNG: the tests must be reproducible, and the production code
// must contain no randomness at all.
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const CAMERA = new THREE.Vector3(0, 24, 150);
const HULL_HALF_LENGTH = 60;
const MODEL_RADIUS = 70;

// 24 fixtures × 12 pixels laid along a hull, both sides, two decks.
const SHIP_FIXTURE_COUNT = 24;
const PIXELS_PER_FIXTURE = 12;

function buildShip() {
  const pixels = [];
  let key = 0;
  for (let f = 0; f < SHIP_FIXTURE_COUNT; f++) {
    const side = f % 2 === 0 ? -12 : 12;
    const deck = f % 4 < 2 ? 2 : 14;
    const x0 = -HULL_HALF_LENGTH + (Math.floor(f / 4) * (2 * HULL_HALF_LENGTH)) / 6;
    for (let p = 0; p < PIXELS_PER_FIXTURE; p++) {
      pixels.push({
        key: key++,
        x: x0 + p * 1.6,
        y: deck,
        z: side,
      });
    }
  }
  return pixels;
}

const SHIP = buildShip();

// A travelling brightness wave — the exact input shape that made the old
// strategies churn: the SET of emitting pixels changes every frame.
function brightnessAt(pixel, frame) {
  const phase = (pixel.x / (2 * HULL_HALF_LENGTH)) - frame / 180;
  const wave = Math.sin(2 * Math.PI * phase);
  return wave <= 0 ? 0 : wave * wave;
}

// A STATIC field: every pixel of the ship lit, nothing moving. This is the
// honest place to measure CONVERGENCE, because the rotation is then the only
// thing that can change the picture — on an animating field the pattern itself
// turns fixtures over and would flatter the measurement.
function staticBrightness() {
  return 0.8;
}

function makeVisible(frame, brightness = brightnessAt) {
  const visible = [];
  for (const pixel of SHIP) {
    const b = brightness(pixel, frame);
    if (b < MIN_ANALYTIC_LIGHT_LUMINANCE) continue; // the analytic light gate
    const worldPos = new THREE.Vector3(pixel.x, pixel.y, pixel.z);
    visible.push({
      key: pixel.key,
      worldPos,
      worldDir: new THREE.Vector3(0, 0, -1),
      color: { r: b, g: b * 0.8, b: b * 0.6 },
      intensity: 5,
      angle: 20,
      penumbra: 0.5,
      distSq: worldPos.distanceToSquared(CAMERA),
      score: 0,
    });
  }
  return visible;
}

function sortedByDistance(visible) {
  return visible.slice().sort((a, b) => a.distSq - b.distSq);
}

// Run a strategy for `frames` frames and report what the operator would see.
function runStrategy(mode, { frames = 600, poolSize = 24, bucketDistance = 10,
  brightness = brightnessAt } = {}) {
  const planner = createSpotlightPlanner();
  const legacy = isLegacySpotlightSamplingMode(mode);
  let previous = new Array(poolSize).fill(null);
  let slotChanges = 0;
  let appearances = 0;
  let maxAppearancesInAFrame = 0;
  let maxGainJump = 0;
  const everShown = new Set();
  const everShownFixtures = new Set();
  const gainTrace = [];
  const keyTrace = [];
  // Cumulative coverage after each frame — the raw material for the
  // convergence measurements below (framesToCover).
  const distinctPixelsByFrame = [];
  const distinctFixturesByFrame = [];

  for (let frame = 0; frame < frames; frame++) {
    const raw = makeVisible(frame, brightness);
    const visible = legacy ? sortedByDistance(raw) : raw;
    const plan = planner.plan({
      mode,
      visible,
      slotBudget: poolSize,
      poolSize,
      bucketDistance,
      modelRadius: MODEL_RADIUS,
    });

    const keys = planner.assignedKeys().slice(0, poolSize);
    const gains = plan.map((entry) => (entry === null ? 0 : entry.gain));
    let appeared = 0;
    for (let i = 0; i < poolSize; i++) {
      if (keys[i] !== previous[i]) {
        slotChanges++;
        if (keys[i] !== null) appeared++;
      }
      if (keys[i] !== null) {
        everShown.add(keys[i]);
        everShownFixtures.add(Math.floor(keys[i] / PIXELS_PER_FIXTURE));
      }
    }
    distinctPixelsByFrame.push(everShown.size);
    distinctFixturesByFrame.push(everShownFixtures.size);
    appearances += appeared;
    if (appeared > maxAppearancesInAFrame) maxAppearancesInAFrame = appeared;

    if (frame > 0) {
      for (let i = 0; i < poolSize; i++) {
        const jump = Math.abs(gains[i] - gainTrace[gainTrace.length - 1][i]);
        // A slot that was released entirely reports gain 0 both ways, so only
        // real envelope motion is measured here.
        if (jump > maxGainJump) maxGainJump = jump;
      }
    }
    gainTrace.push(gains);
    keyTrace.push(keys);
    previous = keys;
  }

  return {
    slotChanges,
    appearances,
    maxAppearancesInAFrame,
    maxGainJump,
    distinctShown: everShown.size,
    distinctFixturesShown: everShownFixtures.size,
    distinctPixelsByFrame,
    distinctFixturesByFrame,
    gainTrace,
    keyTrace,
  };
}

/**
 * The frame on which a cumulative-coverage series first reached `target`, or
 * null if it never did. 1-based, so the number reads as "N frames in".
 */
function framesToCover(series, target) {
  for (let i = 0; i < series.length; i++) {
    if (series[i] >= target) return i + 1;
  }
  return null;
}

/**
 * The planner frames on which slot `slotIndex` changed which fixture it
 * represents. 1-based, matching the planner's own frame counter (keyTrace[i] is
 * the state after frame i+1). The initial FILL is not reported — it has no
 * predecessor frame — so entry 0 is the slot's first genuine turn.
 */
function keyChangeFrames(keyTrace, slotIndex) {
  const frames = [];
  for (let i = 1; i < keyTrace.length; i++) {
    if (keyTrace[i][slotIndex] !== keyTrace[i - 1][slotIndex]) frames.push(i + 1);
  }
  return frames;
}

// ── 1. The roster, and the loud refusal ─────────────────────────────────

test('the strategy roster is the five named modes, in dropdown order', () => {
  assert.deepEqual(SPOTLIGHT_SAMPLING_MODES, [
    'closest',
    'closest_bucket',
    'uniform',
    'stable_importance',
    'rotating_coverage',
  ]);
});

test('an unknown strategy is refused loudly — never coerced to a default', () => {
  for (const bad of ['', 'CLOSEST', 'closest ', 'stable', 'nearest', null, undefined, 7, {}]) {
    assert.throws(
      () => assertSpotlightSamplingMode(bad, 'test'),
      (err) => err instanceof RangeError
        && /unknown sampling strategy/.test(err.message)
        && /closest, closest_bucket, uniform, stable_importance, rotating_coverage/.test(err.message),
      `expected ${JSON.stringify(bad)} to be refused`
    );
  }
});

test('the shipped default is rotating_coverage, and it is a real strategy', () => {
  assert.equal(DEFAULT_SPOTLIGHT_SAMPLING_MODE, 'rotating_coverage');
  assert.ok(SPOTLIGHT_SAMPLING_MODES.includes(DEFAULT_SPOTLIGHT_SAMPLING_MODE));
});

test('a scene with NO recorded value gets the code default — everything else is its own', () => {
  // `undefined` is the one and only "no opinion recorded" input. It is not a
  // fallback: there is nothing to fall back from.
  assert.equal(
    resolveSpotlightSamplingMode(undefined, 'test'),
    DEFAULT_SPOTLIGHT_SAMPLING_MODE
  );
  // A recorded value always wins over the default, including a recorded value
  // that happens to equal it.
  for (const mode of SPOTLIGHT_SAMPLING_MODES) {
    assert.equal(resolveSpotlightSamplingMode(mode, 'test'), mode);
  }
  // And a recorded value that names no real strategy still throws — the
  // default must never swallow a typo (codex P0).
  for (const bad of [null, '', 'CLOSEST', 'rotating', 'rotating_coverages', 7, {}]) {
    assert.throws(
      () => resolveSpotlightSamplingMode(bad, 'test'),
      (err) => err instanceof RangeError && /unknown sampling strategy/.test(err.message),
      `expected ${JSON.stringify(bad)} to be refused, not defaulted`
    );
  }
});

test('every roster entry validates, and only the three originals are legacy', () => {
  for (const mode of SPOTLIGHT_SAMPLING_MODES) {
    assert.equal(assertSpotlightSamplingMode(mode, 'test'), mode);
  }
  assert.equal(isLegacySpotlightSamplingMode('closest'), true);
  assert.equal(isLegacySpotlightSamplingMode('closest_bucket'), true);
  assert.equal(isLegacySpotlightSamplingMode('uniform'), true);
  assert.equal(isLegacySpotlightSamplingMode('stable_importance'), false);
  assert.equal(isLegacySpotlightSamplingMode('rotating_coverage'), false);
});

// ── 2. Legacy selection semantics, byte for byte ────────────────────────

test('uniform stride arithmetic is unchanged, including the sampleCount===1 case', () => {
  const list = Array.from({ length: 17 }, (_, i) => ({ key: i }));
  for (let count = 0; count <= 20; count++) {
    assert.deepEqual(
      sampleUniformRequests(list, count),
      originalSampleUniformRequests(list, count),
      `sampleCount=${count}`
    );
  }
  // The shipped oddity: one sample picks the LAST element, not the first.
  assert.equal(sampleUniformRequests(list, 1)[0].key, 16);
});

test('closest / closest_bucket / uniform choose exactly what they always chose', () => {
  const random = rng(0xc0ffee);
  const out = [];
  let cases = 0;
  for (let trial = 0; trial < 300; trial++) {
    const count = Math.floor(random() * 120);
    const visible = [];
    for (let i = 0; i < count; i++) {
      // Deliberately includes exact ties, zeros, and clustered depths — the
      // places a re-implementation would drift.
      const d = Math.floor(random() * 12) * Math.floor(random() * 40);
      visible.push({ key: i, distSq: d });
    }
    visible.sort((a, b) => a.distSq - b.distSq);
    const budget = Math.floor(random() * 40);
    const bucketDistance = 2 + Math.floor(random() * 19);

    for (const mode of ['closest', 'closest_bucket', 'uniform']) {
      const activeLimit = Math.min(visible.length, budget);
      const expected = originalSelect(mode, visible, activeLimit, bucketDistance)
        .map((r) => r.key);
      selectLegacySample(mode, visible, budget, bucketDistance, out);
      assert.deepEqual(out.map((r) => r.key), expected,
        `mode=${mode} trial=${trial} V=${visible.length} budget=${budget} bucket=${bucketDistance}`);
      cases++;
    }
  }
  assert.equal(cases, 900);
});

test('the closest_bucket window is identical on a real frame sequence', () => {
  const out = [];
  for (let frame = 0; frame < 200; frame++) {
    const visible = sortedByDistance(makeVisible(frame));
    if (visible.length === 0) continue;
    for (const budget of [1, 6, 24, 200]) {
      const activeLimit = Math.min(visible.length, budget);
      const expected = originalSelect('closest_bucket', visible, activeLimit, 10).map((r) => r.key);
      selectLegacySample('closest_bucket', visible, budget, 10, out);
      assert.deepEqual(out.map((r) => r.key), expected, `frame=${frame} budget=${budget}`);
    }
  }
});

test('`closest` is reachable now — it used to be silently rewritten to `uniform`', () => {
  // The old resolver accepted only closest_bucket and uniform and returned
  // uniform for everything else, so the dropdown's `closest` option ran the
  // uniform code path and the selector's `closest` branch was dead.
  const visible = sortedByDistance(makeVisible(3));
  assert.ok(visible.length > 12, 'need more requests than slots for this to differ');
  const closest = [];
  const uniform = [];
  selectLegacySample('closest', visible, 8, 10, closest);
  selectLegacySample('uniform', visible, 8, 10, uniform);
  assert.notDeepEqual(closest.map((r) => r.key), uniform.map((r) => r.key));
  // and `closest` really is the 8 nearest, in order
  assert.deepEqual(closest.map((r) => r.key), visible.slice(0, 8).map((r) => r.key));
});

// ── 3. Churn: what "flicker" actually measures ──────────────────────────

test('stable_importance reassigns dramatically less than the positional strategies', () => {
  const bucket = runStrategy('closest_bucket');
  const uniform = runStrategy('uniform');
  const closest = runStrategy('closest');
  const stable = runStrategy('stable_importance');

  // Sanity: the legacy strategies really do churn on this input.
  assert.ok(bucket.slotChanges > 2000, `closest_bucket slotChanges=${bucket.slotChanges}`);
  assert.ok(uniform.slotChanges > 2000, `uniform slotChanges=${uniform.slotChanges}`);

  assert.ok(
    stable.slotChanges * 10 < bucket.slotChanges,
    `stable=${stable.slotChanges} must be >10x calmer than closest_bucket=${bucket.slotChanges}`
  );
  assert.ok(
    stable.slotChanges * 10 < uniform.slotChanges,
    `stable=${stable.slotChanges} must be >10x calmer than uniform=${uniform.slotChanges}`
  );
  assert.ok(
    stable.slotChanges < closest.slotChanges,
    `stable=${stable.slotChanges} vs closest=${closest.slotChanges}`
  );
});

test('stable_importance never adds more lights in one frame than its bounds allow', () => {
  const stable = runStrategy('stable_importance');
  assert.ok(
    stable.maxAppearancesInAFrame <= STABLE_MAX_FILLS_PER_FRAME + STABLE_MAX_HANDOFFS_PER_FRAME,
    `maxAppearancesInAFrame=${stable.maxAppearancesInAFrame}`
  );
});

test('the positional strategies pop: a whole frame of lights can turn over at once', () => {
  const bucket = runStrategy('closest_bucket');
  const uniform = runStrategy('uniform');
  // With 24 slots, a single frame replacing more than a third of them is a
  // visible flash. Both legacy modes do it; this pins the failure mode the new
  // strategy exists to remove.
  assert.ok(bucket.maxAppearancesInAFrame > 8, `closest_bucket=${bucket.maxAppearancesInAFrame}`);
  assert.ok(uniform.maxAppearancesInAFrame > 8, `uniform=${uniform.maxAppearancesInAFrame}`);
});

// ── 4. Hysteresis ───────────────────────────────────────────────────────

// A two-pixel, one-slot world. Both sit at the same point so proximity is
// identical and only brightness separates them — the hysteresis margin is then
// exactly a ratio of importance scores, with nothing else in the way.
//
// The first WARMUP frames run with the challenger nearly dark, so pixel 1 is
// the settled INCUMBENT before the contest starts. (On frame 0 there is no
// incumbent to protect — whoever scores highest simply fills the empty slot.)
const HYSTERESIS_WARMUP_FRAMES = 60;
const INCUMBENT_BRIGHTNESS = 0.5;

// The brightness a challenger needs for its importance score to be `ratio`
// times the incumbent's.
function challengerBrightnessForScoreRatio(ratio) {
  const incumbentScore = IMPORTANCE_BRIGHTNESS_FLOOR
    + (1 - IMPORTANCE_BRIGHTNESS_FLOOR) * INCUMBENT_BRIGHTNESS;
  return (incumbentScore * ratio - IMPORTANCE_BRIGHTNESS_FLOOR)
    / (1 - IMPORTANCE_BRIGHTNESS_FLOOR);
}

function twoPixelRun(challengerBrightness, frames) {
  const planner = createSpotlightPlanner();
  const at = new THREE.Vector3(0, 0, 0);
  const trace = [];
  for (let frame = 0; frame < HYSTERESIS_WARMUP_FRAMES + frames; frame++) {
    const cb = frame < HYSTERESIS_WARMUP_FRAMES
      ? 0.02
      : challengerBrightness(frame - HYSTERESIS_WARMUP_FRAMES);
    const visible = [
      makeRequest(1, at, INCUMBENT_BRIGHTNESS),
      makeRequest(2, at, cb),
    ];
    const plan = planner.plan({
      mode: 'stable_importance',
      visible,
      slotBudget: 1,
      poolSize: 1,
      bucketDistance: 10,
      modelRadius: MODEL_RADIUS,
    });
    if (frame < HYSTERESIS_WARMUP_FRAMES) {
      assert.equal(planner.assignedKeys()[0], 1, 'warmup must settle on the incumbent');
      continue;
    }
    trace.push({
      key: planner.assignedKeys()[0],
      gain: plan[0] === null ? 0 : plan[0].gain,
    });
  }
  return trace;
}

function makeRequest(key, worldPos, brightness) {
  return {
    key,
    worldPos,
    worldDir: new THREE.Vector3(0, 0, -1),
    color: { r: brightness, g: brightness, b: brightness },
    intensity: 5,
    angle: 20,
    penumbra: 0.5,
    distSq: worldPos.distanceToSquared(CAMERA),
    score: 0,
  };
}

test('a challenger below the hysteresis margin never takes the slot', () => {
  const brightness = challengerBrightnessForScoreRatio(STABLE_HYSTERESIS_MARGIN * 0.95);
  const trace = twoPixelRun(() => brightness, 400);
  assert.ok(trace.every((t) => t.key === 1), 'the incumbent must hold its slot');
});

test('a challenger over the margin must hold it for the full frame count', () => {
  const trace = twoPixelRun(() => 1, 400);
  const wonAt = trace.findIndex((t) => t.key === 2);
  assert.ok(wonAt > 0, 'the challenger must eventually win');
  // It cannot win before STABLE_HYSTERESIS_FRAMES of sustained lead PLUS the
  // incumbent's full fade-out — the slot only changes hands at gain 0. The
  // adoption lands on the same frame as the last fade step, hence the -1
  // (frames are counted from 0).
  const earliest = STABLE_HYSTERESIS_FRAMES + STABLE_FADE_FRAMES - 1;
  assert.ok(wonAt >= earliest, `won at frame ${wonAt}, expected no earlier than ${earliest}`);
  assert.ok(wonAt <= earliest + 2, `won at frame ${wonAt}, unexpectedly late`);
});

test('a challenger that flickers across the margin never wins', () => {
  // Alternates clearly over and clearly under the margin, so the
  // consecutive-frame counter resets before it can ever fire.
  const over = challengerBrightnessForScoreRatio(STABLE_HYSTERESIS_MARGIN * 1.4);
  const under = challengerBrightnessForScoreRatio(STABLE_HYSTERESIS_MARGIN * 0.6);
  const trace = twoPixelRun((frame) => (frame % 2 === 0 ? over : under), 600);
  assert.ok(trace.every((t) => t.key === 1), 'a flickering challenger must never win');
});

test('the margin constant is the line the incumbent is protected by', () => {
  const over = twoPixelRun(
    () => challengerBrightnessForScoreRatio(STABLE_HYSTERESIS_MARGIN * 1.05), 600);
  const under = twoPixelRun(
    () => challengerBrightnessForScoreRatio(STABLE_HYSTERESIS_MARGIN * 0.98), 600);
  assert.ok(over.some((t) => t.key === 2), 'over the margin must win');
  assert.ok(under.every((t) => t.key === 1), 'under the margin must never win');
});

// ── 5. Crossfade ────────────────────────────────────────────────────────

test('a handoff is a monotone fade down and a monotone fade up — never a cut', () => {
  const trace = twoPixelRun(() => 1, 200);
  const step = 1 / STABLE_FADE_FRAMES;
  const handoff = trace.findIndex((t) => t.key === 2);
  assert.ok(handoff > 0);

  // Walk back to where the incumbent started fading out.
  let start = handoff;
  while (start > 0 && trace[start - 1].gain > trace[start].gain) start--;
  // Down leg: strictly decreasing to 0, one step at a time.
  for (let i = start; i < handoff; i++) {
    assert.ok(trace[i].gain >= trace[i + 1].gain, `not monotone down at ${i}`);
    assert.ok(trace[i].gain - trace[i + 1].gain <= step + 1e-9, `jumped at ${i}`);
  }
  assert.ok(trace[handoff - 1].gain <= step + 1e-9, 'the fade must reach 0 before the swap');

  // Up leg: monotone back to 1, one step at a time, on the NEW key.
  let i = handoff;
  while (i + 1 < trace.length && trace[i + 1].key === 2 && trace[i + 1].gain > trace[i].gain) {
    assert.ok(trace[i + 1].gain - trace[i].gain <= step + 1e-9, `jumped up at ${i}`);
    i++;
  }
  assert.ok(trace[i].gain === 1, `never reached full brightness (${trace[i].gain})`);
});

test('no stable-mode gain ever moves faster than one crossfade step per frame', () => {
  const stable = runStrategy('stable_importance');
  assert.ok(
    stable.maxGainJump <= 1 / STABLE_FADE_FRAMES + 1e-9,
    `maxGainJump=${stable.maxGainJump}`
  );
  const rotating = runStrategy('rotating_coverage', { frames: 900 });
  assert.ok(
    rotating.maxGainJump <= 1 / ROTATION_FADE_FRAMES + 1e-9,
    `maxGainJump=${rotating.maxGainJump}`
  );
});

// ── 6. Determinism ──────────────────────────────────────────────────────

test('two runs of the same input produce identical plans, frame for frame', () => {
  for (const mode of SPOTLIGHT_SAMPLING_MODES) {
    const a = runStrategy(mode, { frames: 400 });
    const b = runStrategy(mode, { frames: 400 });
    assert.deepEqual(a.keyTrace, b.keyTrace, `${mode}: keys diverged`);
    assert.deepEqual(a.gainTrace, b.gainTrace, `${mode}: gains diverged`);
  }
});

// ── 7. Coverage ─────────────────────────────────────────────────────────

// One very bright cluster at the bow, the rest of the ship dim but lit.
function clusteredBrightness(pixel) {
  return pixel.x < -HULL_HALF_LENGTH + 12 ? 1 : 0.12;
}

function cellsCovered(mode, poolSize) {
  const planner = createSpotlightPlanner();
  const legacy = isLegacySpotlightSamplingMode(mode);
  let plan = null;
  for (let frame = 0; frame < 300; frame++) {
    const raw = makeVisible(frame, clusteredBrightness);
    const visible = legacy ? sortedByDistance(raw) : raw;
    plan = planner.plan({
      mode, visible, slotBudget: poolSize, poolSize, bucketDistance: 10,
      modelRadius: MODEL_RADIUS,
    });
  }
  const cellSize = (2 * MODEL_RADIUS) / COVERAGE_GRID_DIVISIONS;
  const cells = new Set();
  for (const entry of plan) {
    if (entry === null || entry.gain <= 0) continue;
    const p = entry.source.worldPos;
    cells.add(`${Math.floor(p.x / cellSize)},${Math.floor(p.y / cellSize)},` +
      `${Math.floor(p.z / cellSize)}`);
  }
  return cells.size;
}

test('one bright cluster cannot starve the rest of the ship under stable_importance', () => {
  const stable = cellsCovered('stable_importance', 12);
  const closest = cellsCovered('closest', 12);
  assert.ok(stable >= 4, `stable_importance covered only ${stable} cells`);
  assert.ok(stable > closest, `stable=${stable} must spread wider than closest=${closest}`);
});

// ── 8. rotating_coverage (experimental) ─────────────────────────────────

test('rotating_coverage time-shares the pool across more fixtures than it has slots', () => {
  const poolSize = 12;
  const rotating = runStrategy('rotating_coverage',
    { frames: ROTATION_PERIOD_FRAMES * 3, poolSize });
  const stable = runStrategy('stable_importance',
    { frames: ROTATION_PERIOD_FRAMES * 3, poolSize });
  assert.ok(
    rotating.distinctShown > poolSize,
    `rotating showed only ${rotating.distinctShown} distinct fixtures with ${poolSize} slots`
  );
  assert.ok(
    rotating.distinctShown >= stable.distinctShown,
    `rotating=${rotating.distinctShown} vs stable=${stable.distinctShown}`
  );
});

test('rotating_coverage stays far calmer than the positional strategies', () => {
  const rotating = runStrategy('rotating_coverage', { frames: 600 });
  const uniform = runStrategy('uniform', { frames: 600 });
  assert.ok(
    rotating.slotChanges * 5 < uniform.slotChanges,
    `rotating=${rotating.slotChanges} vs uniform=${uniform.slotChanges}`
  );
});

test('the _192 speed-up did not buy convergence with churn', () => {
  // Rotating turns slots over on purpose, so it can never be as still as
  // stable_importance in principle — but on an animating field the pattern's
  // own turnover dominates, and rotating must not come out BUSIER than the
  // recommendation it is built on. Measured: rotating 436, stable 466 over 600
  // frames with 24 slots (pre-_192 rotating was 370 — the faster cycle costs
  // ~66 extra slot changes in 10 s, i.e. 0.11 per frame).
  const rotating = runStrategy('rotating_coverage', { frames: 600 });
  const stable = runStrategy('stable_importance', { frames: 600 });
  assert.ok(
    rotating.slotChanges <= stable.slotChanges * 1.25,
    `rotating=${rotating.slotChanges} vs stable_importance=${stable.slotChanges}`
  );
  assert.ok(
    rotating.maxAppearancesInAFrame
      <= STABLE_MAX_FILLS_PER_FRAME + STABLE_MAX_HANDOFFS_PER_FRAME,
    `maxAppearancesInAFrame=${rotating.maxAppearancesInAFrame}`
  );
});

// ── 8b. The slow regime, and how fast it converges (_192) ───────────────
// The operator asked for faster convergence. Everything here is the proof that
// it got faster WITHOUT leaving the slow, non-strobing regime _191 established.

// Where flicker starts being visible at all for a bright source on a dark
// field. Critical flicker FUSION is higher still (~50-60 Hz) — this is the
// conservative line, and the rotation must sit far below even this one.
const VISIBLE_FLICKER_FLOOR_HZ = 15;
const SIM_FPS = 60;

test('the rotation is two orders of magnitude below any flicker percept', () => {
  // A slot's gain envelope dips to 0 and back exactly once per period, so the
  // per-slot modulation frequency is fps/period. At 210 frames that is
  // 0.286 Hz — 52× below the visible-flicker floor and ~190× below CFF.
  const perSlotHz = SIM_FPS / ROTATION_PERIOD_FRAMES;
  assert.ok(
    perSlotHz * 40 < VISIBLE_FLICKER_FLOOR_HZ,
    `per-slot modulation is ${perSlotHz.toFixed(3)} Hz — not far enough below ` +
    `${VISIBLE_FLICKER_FLOOR_HZ} Hz. Read the CFF block in spotlight_sampling.js ` +
    'before shortening the period further.'
  );
  // A fixture that has had its turn is excluded for the memory window, so its
  // own on/off cycle is slower still.
  assert.ok(ROTATION_MEMORY_FRAMES > ROTATION_PERIOD_FRAMES * 2);
  // The rotation crossfade is FORCED — nothing in the picture changed to
  // motivate it — so it must never be sharper than the one stable_importance
  // uses for a change the picture actually asked for.
  assert.ok(
    ROTATION_FADE_FRAMES > STABLE_FADE_FRAMES,
    `rotation fade ${ROTATION_FADE_FRAMES} must stay gentler than ${STABLE_FADE_FRAMES}`
  );
  // The warmup compresses the FIRST turn only, and must still leave room for a
  // full fade-out plus fade-in inside it.
  assert.equal(ROTATION_WARMUP_PERIOD_FRAMES * 2, ROTATION_PERIOD_FRAMES);
  assert.ok(ROTATION_WARMUP_PERIOD_FRAMES > ROTATION_FADE_FRAMES * 2);
  // The shipped numbers, pinned. Changing them is a deliberate act: re-read the
  // CFF block and re-run the convergence tests below.
  assert.equal(ROTATION_PERIOD_FRAMES, 210);   // 3.5 s
  assert.equal(ROTATION_FADE_FRAMES, 20);      // 0.333 s
  assert.equal(ROTATION_WARMUP_PERIOD_FRAMES, 105);  // 1.75 s
});

// What the pre-_192 schedule (360-frame period, 30-frame fade, no warmup)
// measured on exactly the runs below. Kept as literals so the speed-up is a
// number in the suite and not a claim in a report.
const PRE_192_FRAMES_TO_75PCT_FIXTURES = 857;
const PRE_192_FRAMES_TO_2X_POOL_PIXELS = 469;

test('coverage converges more than twice as fast as the pre-_192 schedule', () => {
  // Static field, 24 slots: how long until three quarters of the ship's
  // fixtures have been REPRESENTED at least once. Nothing but the rotation can
  // move this number.
  const target = Math.ceil(0.75 * SHIP_FIXTURE_COUNT);
  const rotating = runStrategy('rotating_coverage',
    { frames: 1200, poolSize: 24, brightness: staticBrightness });
  const frames = framesToCover(rotating.distinctFixturesByFrame, target);
  assert.ok(frames !== null, `never reached ${target} of ${SHIP_FIXTURE_COUNT} fixtures`);
  // Measured: 386 frames (6.4 s), against 857 (14.3 s) before — 2.22×.
  assert.ok(
    frames * 1.8 <= PRE_192_FRAMES_TO_75PCT_FIXTURES,
    `${frames} frames to ${target} fixtures — less than 1.8× faster than the ` +
    `pre-_192 ${PRE_192_FRAMES_TO_75PCT_FIXTURES}`
  );
  assert.ok(frames <= 480, `${frames} frames — slower than the measured 386 by more than 25%`);

  // And a strategy with no rotation at all never gets there: this is coverage
  // the rotation is buying, not coverage the scene was giving away.
  const stable = runStrategy('stable_importance',
    { frames: 1200, poolSize: 24, brightness: staticBrightness });
  assert.equal(framesToCover(stable.distinctFixturesByFrame, target), null);
});

test('a 12-slot pool represents 2× its own size in fixtures twice as fast', () => {
  const rotating = runStrategy('rotating_coverage',
    { frames: 1200, poolSize: 12, brightness: staticBrightness });
  const frames = framesToCover(rotating.distinctPixelsByFrame, 24);
  assert.ok(frames !== null, 'never represented 24 distinct fixtures');
  // Measured: 203 frames (3.4 s), against 469 (7.8 s) before — 2.31×.
  assert.ok(
    frames * 1.8 <= PRE_192_FRAMES_TO_2X_POOL_PIXELS,
    `${frames} frames to 24 distinct — less than 1.8× faster than the ` +
    `pre-_192 ${PRE_192_FRAMES_TO_2X_POOL_PIXELS}`
  );
  assert.ok(frames <= 260, `${frames} frames — slower than the measured 203 by more than 25%`);
});

test('the first turn is compressed, and then it settles to the steady cycle', () => {
  // One slot, static field: slot 0 has no stagger, so its schedule is exactly
  // the warmup period and then the full period, with a crossfade on each.
  const run = runStrategy('rotating_coverage',
    { frames: ROTATION_PERIOD_FRAMES * 3, poolSize: 1, brightness: staticBrightness });
  const turns = keyChangeFrames(run.keyTrace, 0);
  assert.ok(turns.length >= 2, `only ${turns.length} slot turn(s) in three periods`);

  const firstTurn = turns[0];
  // It cannot come before the warmup schedule allows, and it must not need
  // more than the warmup plus one full fade-out. Measured: frame 125, i.e.
  // exactly ROTATION_WARMUP_PERIOD_FRAMES + ROTATION_FADE_FRAMES.
  assert.ok(
    firstTurn > ROTATION_WARMUP_PERIOD_FRAMES,
    `first turn at frame ${firstTurn}, earlier than the warmup period`
  );
  assert.ok(
    firstTurn <= ROTATION_WARMUP_PERIOD_FRAMES + ROTATION_FADE_FRAMES + 2,
    `first turn at frame ${firstTurn}, later than warmup + fade`
  );
  // The whole point: it is strictly earlier than an uncompressed first cycle
  // would have been — which was period + stagger + fade, up to two periods.
  assert.ok(
    firstTurn < ROTATION_PERIOD_FRAMES,
    `first turn at frame ${firstTurn} is no faster than a full cycle`
  );

  // Then steady state: the NEXT turn is a full period later, not another
  // warmup. The compression is one turn per slot, not a permanently faster
  // mode. Measured: exactly ROTATION_PERIOD_FRAMES.
  const gap = turns[1] - turns[0];
  assert.ok(
    gap >= ROTATION_PERIOD_FRAMES,
    `second turn came ${gap} frames after the first — the warmup leaked into steady state`
  );
  assert.ok(
    gap <= ROTATION_PERIOD_FRAMES + ROTATION_FADE_FRAMES + 2,
    `second turn came ${gap} frames after the first — slower than the steady cycle`
  );
});

test('the compressed first turn changes nothing about how a handoff looks', () => {
  // Same invariants as the crossfade section, measured across the warmup window
  // specifically: no gain step bigger than one crossfade step, and no frame
  // adding more lights than the bounds allow.
  const run = runStrategy('rotating_coverage',
    { frames: ROTATION_PERIOD_FRAMES * 2, poolSize: 24, brightness: staticBrightness });
  assert.ok(
    run.maxGainJump <= 1 / ROTATION_FADE_FRAMES + 1e-9,
    `maxGainJump=${run.maxGainJump}`
  );
  assert.ok(
    run.maxAppearancesInAFrame
      <= STABLE_MAX_FILLS_PER_FRAME + STABLE_MAX_HANDOFFS_PER_FRAME,
    `maxAppearancesInAFrame=${run.maxAppearancesInAFrame}`
  );
});

test('a reset re-arms the compressed first turn — a strategy switch paints in too', () => {
  const planner = createSpotlightPlanner();
  const poolSize = 1;
  const plan = (frame) => planner.plan({
    mode: 'rotating_coverage', visible: makeVisible(frame, staticBrightness),
    slotBudget: poolSize, poolSize, bucketDistance: 10, modelRadius: MODEL_RADIUS,
  });

  // Run well past the first turn so the slot is on the steady schedule.
  for (let frame = 0; frame < ROTATION_PERIOD_FRAMES + 60; frame++) plan(frame);
  planner.reset();

  // After a reset the slot refills and must get the WARMUP schedule again, not
  // the steady one — this is the boot / strategy-switch / lighting-back-on path.
  const keyTrace = [];
  for (let frame = 0; frame < ROTATION_PERIOD_FRAMES; frame++) {
    plan(frame);
    keyTrace.push([planner.assignedKeys()[0]]);
  }
  const turns = keyChangeFrames(keyTrace, 0);
  assert.ok(turns.length >= 1, 'no turn at all inside a period after the reset');
  // Same timing as a cold boot: warmup + one fade. Without the re-arm the first
  // turn would land at ROTATION_PERIOD_FRAMES + fade, outside this window.
  assert.ok(
    turns[0] <= ROTATION_WARMUP_PERIOD_FRAMES + ROTATION_FADE_FRAMES + 2,
    `first turn after reset at frame ${turns[0]} — the warmup did not re-arm`
  );
});

// ── 9. Plan shape and mode switching ────────────────────────────────────

test('the plan is one entry per pool slot, and unused slots are null', () => {
  const planner = createSpotlightPlanner();
  const visible = sortedByDistance(makeVisible(5));
  const plan = planner.plan({
    mode: 'uniform', visible, slotBudget: 4, poolSize: 10, bucketDistance: 10,
    modelRadius: MODEL_RADIUS,
  });
  assert.equal(plan.length, 10);
  for (let i = 0; i < 4; i++) {
    assert.ok(plan[i] !== null, `slot ${i} should be assigned`);
    assert.equal(plan[i].gain, 1, 'positional strategies have no crossfade');
  }
  for (let i = 4; i < 10; i++) assert.equal(plan[i], null);
});

test('switching strategy drops the previous strategy’s half-faded state', () => {
  const planner = createSpotlightPlanner();
  const poolSize = 8;
  for (let frame = 0; frame < 60; frame++) {
    planner.plan({
      mode: 'stable_importance', visible: makeVisible(frame), slotBudget: poolSize,
      poolSize, bucketDistance: 10, modelRadius: MODEL_RADIUS,
    });
  }
  assert.ok(planner.assignedKeys().some((k) => k !== null));
  const plan = planner.plan({
    mode: 'uniform', visible: sortedByDistance(makeVisible(60)), slotBudget: poolSize,
    poolSize, bucketDistance: 10, modelRadius: MODEL_RADIUS,
  });
  // Back on a positional strategy every assigned slot is at full gain
  // immediately — no residue of the stable envelope.
  for (const entry of plan) {
    if (entry !== null) assert.equal(entry.gain, 1);
  }
});

test('reset() drops every assignment — the analytic-lighting-off path', () => {
  const planner = createSpotlightPlanner();
  const poolSize = 8;
  for (let frame = 0; frame < 60; frame++) {
    planner.plan({
      mode: 'stable_importance', visible: makeVisible(frame), slotBudget: poolSize,
      poolSize, bucketDistance: 10, modelRadius: MODEL_RADIUS,
    });
  }
  assert.ok(planner.assignedKeys().some((k) => k !== null));
  planner.reset();
  assert.ok(planner.assignedKeys().every((k) => k === null));
  // And the first frame back starts from zero gain, not from a stale envelope.
  const plan = planner.plan({
    mode: 'stable_importance', visible: makeVisible(61), slotBudget: poolSize,
    poolSize, bucketDistance: 10, modelRadius: MODEL_RADIUS,
  });
  for (const entry of plan) {
    if (entry !== null) assert.ok(entry.gain <= 1 / STABLE_FADE_FRAMES + 1e-9);
  }
});

test('an empty frame releases every slot without throwing', () => {
  const planner = createSpotlightPlanner();
  for (const mode of SPOTLIGHT_SAMPLING_MODES) {
    for (let frame = 0; frame < 40; frame++) {
      const plan = planner.plan({
        mode, visible: [], slotBudget: 6, poolSize: 6, bucketDistance: 10,
        modelRadius: MODEL_RADIUS,
      });
      assert.equal(plan.length, 6);
    }
    const finalPlan = planner.plan({
      mode, visible: [], slotBudget: 6, poolSize: 6, bucketDistance: 10,
      modelRadius: MODEL_RADIUS,
    });
    for (const entry of finalPlan) assert.equal(entry, null, `${mode} left a slot lit`);
  }
});

// ── 10. The boot gate in light_pool ─────────────────────────────────────
// A fresh module instance per boot: the pool is a one-shot singleton.
let _bootCounter = 0;
async function bootLightPool(samplingMode) {
  const added = [];
  setScene({ add: (obj) => added.push(obj), traverse: (cb) => added.forEach(cb) });
  setModelRadius(50);
  params.maxSpotlights = 8;
  // `undefined` means the scene recorded NO value — the key is absent from the
  // config tree, which is the only input that may reach the code default.
  if (samplingMode === undefined) delete params.spotlightSamplingMode;
  else params.spotlightSamplingMode = samplingMode;
  return import(`../src/core/light_pool.js?sampling_boot=${++_bootCounter}`);
}

function captureConsole(fn) {
  const real = { log: console.log, warn: console.warn, error: console.error };
  const lines = [];
  console.log = () => {};
  console.warn = (...args) => lines.push(args.join(' '));
  console.error = (...args) => lines.push(args.join(' '));
  try {
    fn();
  } finally {
    Object.assign(console, real);
  }
  return lines;
}

test('a scene naming a strategy that does not exist fails the pool boot, loudly', async () => {
  const mod = await bootLightPool('closest_buckets');
  assert.throws(
    () => mod.initLightPool(),
    (err) => err instanceof RangeError
      && /unknown sampling strategy "closest_buckets"/.test(err.message)
      && /common\.yaml/.test(err.message)
  );
});

test('a present malformed strategy leaf fails config extraction instead of becoming absent', () => {
  delete params.spotlightSamplingMode;
  assert.throws(
    () => extractParams({
      options: {
        spotlightSamplingMode: { label: 'Sim Spotlight Sampling' },
      },
    }),
    (err) => err instanceof TypeError
      && /spotlightSamplingMode is present but malformed/.test(err.message)
  );
  assert.equal(params.spotlightSamplingMode, undefined);
});

test('every roster strategy boots the pool', async () => {
  const real = { log: console.log, warn: console.warn, error: console.error };
  for (const mode of SPOTLIGHT_SAMPLING_MODES) {
    const mod = await bootLightPool(mode);
    console.log = () => {};
    console.warn = () => {};
    try {
      mod.initLightPool();
    } finally {
      Object.assign(console, real);
    }
    assert.equal(mod.isPoolInitialized(), true, `${mode} failed to boot the pool`);
    assert.equal(mod.getPoolSize(), 8, `${mode} allocated the wrong pool`);
  }
});

test('a scene that records no strategy boots on the code default, and says so', async () => {
  const mod = await bootLightPool(undefined);
  assert.equal(params.spotlightSamplingMode, undefined, 'the harness must start with no value');

  const lines = captureConsole(() => mod.initLightPool());

  assert.equal(mod.isPoolInitialized(), true);
  // Resolved ONCE at boot and written back onto params, so the per-frame reader
  // and the GUI dropdown both see what is actually running.
  assert.equal(params.spotlightSamplingMode, DEFAULT_SPOTLIGHT_SAMPLING_MODE);
  // And it is not silent — the operator can tell a default from a choice.
  assert.ok(
    lines.some((line) => /records no options\.spotlightSamplingMode/.test(line)
      && line.includes(DEFAULT_SPOTLIGHT_SAMPLING_MODE)),
    `no default notice in the console output: ${JSON.stringify(lines)}`
  );
});

test('pulling the slider down fades the surplus slots out instead of cutting them', () => {
  const planner = createSpotlightPlanner();
  const poolSize = 12;
  for (let frame = 0; frame < 120; frame++) {
    planner.plan({
      mode: 'stable_importance', visible: makeVisible(frame), slotBudget: poolSize,
      poolSize, bucketDistance: 10, modelRadius: MODEL_RADIUS,
    });
  }
  const before = planner.plan({
    mode: 'stable_importance', visible: makeVisible(120), slotBudget: 4,
    poolSize, bucketDistance: 10, modelRadius: MODEL_RADIUS,
  });
  // The frame the budget drops, the surplus slots must still be lit (fading).
  const litAbove = before.slice(4).filter((e) => e !== null && e.gain > 0).length;
  assert.ok(litAbove > 0, 'surplus slots were cut, not faded');

  for (let frame = 121; frame < 121 + STABLE_FADE_FRAMES + 2; frame++) {
    planner.plan({
      mode: 'stable_importance', visible: makeVisible(frame), slotBudget: 4,
      poolSize, bucketDistance: 10, modelRadius: MODEL_RADIUS,
    });
  }
  const after = planner.plan({
    mode: 'stable_importance', visible: makeVisible(200), slotBudget: 4,
    poolSize, bucketDistance: 10, modelRadius: MODEL_RADIUS,
  });
  for (let i = 4; i < poolSize; i++) {
    assert.ok(after[i] === null || after[i].gain === 0, `slot ${i} still lit after the fade`);
  }
});
