// metrics.js — reduce a rendered frame sequence to a fixed feature vector.
//
// Every feature is a plain number so two renders can be differenced and the
// difference compared against a documented threshold. Nothing here knows what
// a parameter is CALLED — naming claims are checked in claims.js against these
// measurements. Keeping the two apart is the whole point: the measurement is
// the evidence, the name is the claim.
//
// Channel layout is the engine's 6-channel byte frame: r, g, b, w, a, uv.
//
// Feature groups
// ──────────────
//  luma / output / channel means  → "how bright, in which emitters"
//  hueCircX,hueCircY / satMean    → "what colour"
//  spatialStd / litFraction       → "how contrasty, how much is lit"
//  spatialFreqX|Y|Z               → "how many features across the model"
//  temporalRate / temporalFreq    → "how fast it moves"
//  driftX|Y|Z (+ gradEnergy*)     → "which way it moves" (signed)

const CH = 6;
const R = 0, G = 1, B = 2, W = 3, A = 4, UV = 5;

/** Spatial profile resolution used by the frequency + drift estimators. */
export const PROFILE_BINS = 24;

/** A pixel counts as "lit" above this 0..1 total drive. */
const LIT_THRESHOLD = 4 / 255;

/** Hue/saturation are only meaningful on a pixel with real RGB output. */
const CHROMA_THRESHOLD = 8 / 255;

/**
 * Per-feature normalisation scale. A raw feature delta is divided by this to
 * get the comparable "normalised change" the classifier thresholds against.
 * These are the natural full-swing ranges of each statistic, chosen once and
 * documented so a verdict is reproducible rather than tuned per pattern.
 */
export const FEATURE_SCALE = {
  lumaMean: 1.0,
  outputMean: 1.0,
  rMean: 1.0,
  gMean: 1.0,
  bMean: 1.0,
  wMean: 1.0,
  aMean: 1.0,
  uvMean: 1.0,
  satMean: 1.0,
  spatialStd: 1.0,
  // Spread RELATIVE to level. A pattern that sharpens its bands also darkens
  // them, so its absolute spread can stay flat while the picture visibly gains
  // contrast — 34_moire_interference does exactly that. Contrast claims are
  // judged on this, not on spatialStd.
  contrastRatio: 1.0,
  litFraction: 1.0,
  spatialFreqX: 1.0,
  spatialFreqY: 1.0,
  spatialFreqZ: 1.0,
  // Steepest bin-to-bin step in the spatial profile: how HARD the sharpest
  // edge in the image is. This is the direct measurement of a feather /
  // softness / sharpness claim — a feathered edge lowers it, a crisp one
  // raises it — and no amount of spatial-frequency counting substitutes for it.
  edgeSharpnessX: 1.0,
  edgeSharpnessY: 1.0,
  edgeSharpnessZ: 1.0,
  // A busy pattern changes ~20 % of full scale per frame; that is the
  // practical ceiling for per-frame temporal change.
  temporalRate: 0.2,
  // Zero-crossing rate saturates at 1 crossing per frame = 0.5 in cycles.
  temporalFreq: 0.5,
  // Drift is in profile bins per frame; half a bin per frame is fast motion.
  driftX: 0.5,
  driftY: 0.5,
  driftZ: 0.5,
  // Hue is circular: max possible distance is 0.5 turns.
  hueMean: 0.5,
};

export const FEATURE_NAMES = Object.keys(FEATURE_SCALE);

/**
 * Bucket pixel indices into PROFILE_BINS along each normalised axis, once per
 * model. Reused for every render on that model.
 *
 * @param {{nx:number, ny:number, nz:number}[]} coords
 * @returns {{ x: number[][], y: number[][], z: number[][] }}
 */
export function buildAxisBins(coords) {
  const make = (key) => {
    const bins = Array.from({ length: PROFILE_BINS }, () => []);
    let lo = Infinity;
    let hi = -Infinity;
    for (const c of coords) {
      if (c[key] < lo) lo = c[key];
      if (c[key] > hi) hi = c[key];
    }
    const span = hi - lo;
    for (let i = 0; i < coords.length; i++) {
      // A degenerate axis (every pixel at the same coordinate) collapses to
      // bin 0; its gradEnergy will be ~0 so the drift estimate on that axis is
      // reported as unreliable rather than silently trusted.
      const t = span > 1e-9 ? (coords[i][key] - lo) / span : 0;
      const bin = Math.min(PROFILE_BINS - 1, Math.floor(t * PROFILE_BINS));
      bins[bin].push(i);
    }
    return bins;
  };
  return { x: make('nx'), y: make('ny'), z: make('nz') };
}

/**
 * Signed 1-D optical flow of a spatial profile pair, in bins per frame.
 *
 * For a profile translating rigidly by `v` bins, dP ≈ -v * dP/dbin. Solving
 * that least-squares over the profile gives a SIGNED velocity, which is what
 * a "direction" claim needs — an unsigned motion magnitude cannot tell a
 * reversal from a speed-up.
 *
 * @param {Float64Array} prev
 * @param {Float64Array} cur
 * @returns {{ v: number, gradEnergy: number }}
 */
function profileFlow(prev, cur) {
  let num = 0;
  let den = 0;
  for (let i = 1; i < prev.length - 1; i++) {
    const grad = (prev[i + 1] - prev[i - 1]) * 0.5;
    const dt = cur[i] - prev[i];
    num += -dt * grad;
    den += grad * grad;
  }
  return { v: den > 1e-12 ? num / den : 0, gradEnergy: den };
}

/**
 * Reduce a frame sequence to the feature vector.
 *
 * @param {Uint8Array[]} frames — 6-channel byte frames, steady state only.
 * @param {number} pixelCount
 * @param {object} axisBins — from buildAxisBins().
 * @returns {Record<string, number>} feature vector (plus derived `hueMean`).
 */
export function measure(frames, pixelCount, axisBins) {
  const nF = frames.length;
  if (nF < 2) throw new Error('metrics.measure needs at least 2 frames');

  const chanSum = [0, 0, 0, 0, 0, 0];
  let clipped = 0;
  let lumaSum = 0;
  let hueX = 0;
  let hueY = 0;
  let hueWeight = 0;
  let satSum = 0;
  let satCount = 0;
  let litCount = 0;
  let spatialStdSum = 0;
  let temporalAbsSum = 0;

  // Per-pixel total-output series, kept for the temporal zero-crossing rate.
  const series = new Float64Array(nF * pixelCount);

  for (let f = 0; f < nF; f++) {
    const buf = frames[f];
    let frameLumaSum = 0;
    let frameLumaSqSum = 0;
    for (let p = 0; p < pixelCount; p++) {
      const o = p * CH;
      const r = buf[o + R] / 255;
      const g = buf[o + G] / 255;
      const b = buf[o + B] / 255;
      const w = buf[o + W] / 255;
      const a = buf[o + A] / 255;
      const uv = buf[o + UV] / 255;

      chanSum[R] += r; chanSum[G] += g; chanSum[B] += b;
      chanSum[W] += w; chanSum[A] += a; chanSum[UV] += uv;

      // Bytes pinned at full scale. A pattern whose output is already clipped
      // cannot show any control that only ADDS light — which is a cause, not
      // just a symptom, and worth reporting alongside a DEAD verdict.
      for (let c = 0; c < CH; c++) if (buf[o + c] === 255) clipped++;

      const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      frameLumaSum += luma;
      frameLumaSqSum += luma * luma;
      lumaSum += luma;

      const total = (r + g + b + w + a + uv) / 6;
      series[f * pixelCount + p] = total;
      if (total > LIT_THRESHOLD) litCount++;

      const mx = Math.max(r, g, b);
      const mn = Math.min(r, g, b);
      if (mx > CHROMA_THRESHOLD) {
        const chroma = mx - mn;
        satSum += chroma / mx;
        satCount++;
        if (chroma > 1e-6) {
          let h;
          if (mx === r) h = ((g - b) / chroma) / 6;
          else if (mx === g) h = (2 + (b - r) / chroma) / 6;
          else h = (4 + (r - g) / chroma) / 6;
          if (h < 0) h += 1;
          // Weight by chroma * value so a dim desaturated pixel cannot drag
          // the circular mean around.
          const wgt = chroma * mx;
          hueX += Math.cos(h * 2 * Math.PI) * wgt;
          hueY += Math.sin(h * 2 * Math.PI) * wgt;
          hueWeight += wgt;
        }
      }
    }
    const mean = frameLumaSum / pixelCount;
    const varr = Math.max(0, frameLumaSqSum / pixelCount - mean * mean);
    spatialStdSum += Math.sqrt(varr);

    if (f > 0) {
      const prev = frames[f - 1];
      for (let p = 0; p < pixelCount; p++) {
        const o = p * CH;
        let d = 0;
        for (let c = 0; c < CH; c++) d += Math.abs(buf[o + c] - prev[o + c]);
        temporalAbsSum += d / (CH * 255);
      }
    }
  }

  const nPix = nF * pixelCount;
  const out = {
    lumaMean: lumaSum / nPix,
    outputMean: (chanSum[R] + chanSum[G] + chanSum[B] + chanSum[W]
      + chanSum[A] + chanSum[UV]) / (nPix * CH),
    rMean: chanSum[R] / nPix,
    gMean: chanSum[G] / nPix,
    bMean: chanSum[B] / nPix,
    wMean: chanSum[W] / nPix,
    aMean: chanSum[A] / nPix,
    uvMean: chanSum[UV] / nPix,
    satMean: satCount > 0 ? satSum / satCount : 0,
    litFraction: litCount / nPix,
    spatialStd: spatialStdSum / nF,
    temporalRate: temporalAbsSum / ((nF - 1) * pixelCount),
    // Diagnostic, not a scored feature: fraction of all channel bytes at 255.
    clippedFraction: clipped / (nPix * CH),
  };
  // The epsilon keeps a nearly-black render from producing a huge ratio out of
  // two tiny numbers.
  out.contrastRatio = out.spatialStd / (out.lumaMean + 0.01);

  // Circular hue mean, plus the resultant length so a pattern with no stable
  // hue (white/UV only, or a full rainbow) is distinguishable from one that
  // genuinely sits at hue 0.
  const resultant = Math.sqrt(hueX * hueX + hueY * hueY) / (hueWeight || 1);
  let hueMean = 0;
  if (hueWeight > 0) {
    hueMean = Math.atan2(hueY, hueX) / (2 * Math.PI);
    if (hueMean < 0) hueMean += 1;
  }
  out.hueMean = hueMean;
  out.hueResultant = hueWeight > 0 ? resultant : 0;
  out.hueWeight = hueWeight / nPix;

  // Temporal zero-crossing rate of each pixel's centred output series.
  let zcSum = 0;
  let zcPixels = 0;
  for (let p = 0; p < pixelCount; p++) {
    let mean = 0;
    for (let f = 0; f < nF; f++) mean += series[f * pixelCount + p];
    mean /= nF;
    let amp = 0;
    for (let f = 0; f < nF; f++) {
      amp = Math.max(amp, Math.abs(series[f * pixelCount + p] - mean));
    }
    // A pixel that never moves has no frequency; counting its noise-level
    // crossings would fabricate one.
    if (amp < LIT_THRESHOLD) continue;
    let crossings = 0;
    let prevSign = 0;
    for (let f = 0; f < nF; f++) {
      const v = series[f * pixelCount + p] - mean;
      const sign = v > 0 ? 1 : (v < 0 ? -1 : 0);
      if (sign !== 0 && prevSign !== 0 && sign !== prevSign) crossings++;
      if (sign !== 0) prevSign = sign;
    }
    zcSum += crossings / (nF - 1);
    zcPixels++;
  }
  out.temporalFreq = zcPixels > 0 ? (zcSum / zcPixels) / 2 : 0;
  out.activePixelFraction = zcPixels / pixelCount;

  // Spatial profiles → spatial frequency + signed drift, per axis.
  for (const [key, bins] of [['X', axisBins.x], ['Y', axisBins.y], ['Z', axisBins.z]]) {
    const profiles = [];
    for (let f = 0; f < nF; f++) {
      const buf = frames[f];
      const prof = new Float64Array(PROFILE_BINS);
      for (let bi = 0; bi < PROFILE_BINS; bi++) {
        const idx = bins[bi];
        if (idx.length === 0) continue;
        let s = 0;
        for (const p of idx) {
          const o = p * CH;
          s += (buf[o + R] + buf[o + G] + buf[o + B]
            + buf[o + W] + buf[o + A] + buf[o + UV]) / (CH * 255);
        }
        prof[bi] = s / idx.length;
      }
      profiles.push(prof);
    }

    let freqSum = 0;
    let edgeSum = 0;
    for (const prof of profiles) {
      let mean = 0;
      let steepest = 0;
      for (let bi = 0; bi < PROFILE_BINS; bi++) mean += prof[bi];
      for (let bi = 1; bi < PROFILE_BINS; bi++) {
        const step = Math.abs(prof[bi] - prof[bi - 1]);
        if (step > steepest) steepest = step;
      }
      edgeSum += steepest;
      mean /= PROFILE_BINS;
      let crossings = 0;
      let prevSign = 0;
      for (let bi = 0; bi < PROFILE_BINS; bi++) {
        const v = prof[bi] - mean;
        const sign = v > 1e-6 ? 1 : (v < -1e-6 ? -1 : 0);
        if (sign !== 0 && prevSign !== 0 && sign !== prevSign) crossings++;
        if (sign !== 0) prevSign = sign;
      }
      freqSum += crossings / (PROFILE_BINS - 1);
    }
    out[`spatialFreq${key}`] = freqSum / nF;
    out[`edgeSharpness${key}`] = edgeSum / nF;

    let vSum = 0;
    let gradSum = 0;
    const perFrame = new Float64Array(nF - 1);
    for (let f = 1; f < nF; f++) {
      const { v, gradEnergy } = profileFlow(profiles[f - 1], profiles[f]);
      // Weight each frame's velocity by how much structure was there to
      // track — a flat profile yields a meaningless velocity.
      vSum += v * gradEnergy;
      gradSum += gradEnergy;
      perFrame[f - 1] = v;
    }
    out[`drift${key}`] = gradSum > 1e-12 ? vSum / gradSum : 0;
    out[`gradEnergy${key}`] = gradSum / (nF - 1);
    // Kept OUT of FEATURE_SCALE (it is a series, not a scalar): a ping-pong
    // sweep nets to ~0 mean drift in both directions, so the only way to see a
    // reversal is to compare the two velocity SERIES against each other.
    out[`driftSeries${key}`] = perFrame;
  }

  return out;
}

/**
 * Pearson correlation of two equal-length series.
 *
 * Returns 0 when either series is effectively constant — an undefined
 * correlation must not be reported as evidence of anything.
 *
 * @param {ArrayLike<number>} a
 * @param {ArrayLike<number>} b
 * @returns {number} correlation in [-1, 1], or 0 if undefined.
 */
export function correlate(a, b) {
  const n = Math.min(a.length, b.length);
  if (n < 4) return 0;
  let ma = 0;
  let mb = 0;
  for (let i = 0; i < n; i++) { ma += a[i]; mb += b[i]; }
  ma /= n; mb /= n;
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < n; i++) {
    const x = a[i] - ma;
    const y = b[i] - mb;
    num += x * y;
    da += x * x;
    db += y * y;
  }
  if (da < 1e-14 || db < 1e-14) return 0;
  return num / Math.sqrt(da * db);
}

/**
 * Circular distance between two hue values, in turns (0..0.5).
 *
 * @param {number} a
 * @param {number} b
 * @returns {number}
 */
export function hueDistance(a, b) {
  const d = Math.abs(a - b) % 1;
  return d > 0.5 ? 1 - d : d;
}

/**
 * Normalised change of one feature across a set of measurements.
 *
 * @param {string} name — feature name.
 * @param {Record<string, number>[]} vectors
 * @returns {number} (max - min) / FEATURE_SCALE[name]; circular for hueMean.
 */
export function normalisedChange(name, vectors) {
  const scale = FEATURE_SCALE[name];
  if (!scale) throw new Error(`metrics: unknown feature '${name}'`);
  if (name === 'hueMean') {
    // Only compare hues that actually exist; an unlit render has no hue and
    // must not register as a hue swing.
    const usable = vectors.filter(v => v.hueWeight > 1e-4);
    if (usable.length < 2) return 0;
    let worst = 0;
    for (let i = 0; i < usable.length; i++) {
      for (let j = i + 1; j < usable.length; j++) {
        worst = Math.max(worst, hueDistance(usable[i].hueMean, usable[j].hueMean));
      }
    }
    return worst / scale;
  }
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of vectors) {
    if (v[name] < lo) lo = v[name];
    if (v[name] > hi) hi = v[name];
  }
  return (hi - lo) / scale;
}

/**
 * Rank features by how much they moved across the sweep.
 *
 * @param {Record<string, number>[]} vectors
 * @param {Record<string, number>} noise — per-feature noise floor to subtract.
 * @returns {{ feature: string, change: number }[]} descending.
 */
export function rankMovers(vectors, noise = {}) {
  return FEATURE_NAMES
    .map(f => ({
      feature: f,
      change: Math.max(0, normalisedChange(f, vectors) - (noise[f] || 0)),
    }))
    .sort((p, q) => q.change - p.change);
}
