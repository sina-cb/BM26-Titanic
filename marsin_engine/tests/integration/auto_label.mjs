/**
 * auto_label.mjs — derive REFERENCE drop + structure labels for real audio
 * by an OFFLINE, NON-CAUSAL analysis that is deliberately INDEPENDENT of
 * the production detector.
 *
 * ── HONESTY (read this) ───────────────────────────────────────────────
 * These are HEURISTIC reference labels, not human-verified ground truth.
 * An autonomous agent cannot listen to audio. To keep the
 * detector-vs-label comparison from being circular, this labeler differs
 * from the causal production detector in three load-bearing ways:
 *   1. NON-CAUSAL — it sees the whole track and uses look-ahead (a drop is
 *      only a drop if the energy STAYS up after the edge), which the
 *      real-time detector cannot do.
 *   2. GLOBAL baselines — region thresholds come from per-track energy
 *      PERCENTILES, not a causal IIR envelope.
 *   3. STEM-aware (when stems exist) — a MUSDB drop is defined by the BASS
 *      and DRUMS stems both engaging and sustaining, a signal the mic-only
 *      detector never sees.
 * The report documents this provenance explicitly; treat the resulting
 * precision/recall as agreement-with-a-heuristic-reference, not absolute
 * accuracy. A human-labeled subset would be the next fidelity step.
 *
 * Codex P0: throws on empty / malformed input rather than emitting a
 * degenerate label track.
 */

const LOW_CUT_HZ = 200;        // sub/bass band edge (matches analyzer lowMaxHz)
const FRAME_MS = 46;           // ~ analyzer hop (512/44100 ≈ 11.6ms ×4)

/** Convert Int16 mono → Float64 in [-1,1]. */
function toFloat(samples) {
  const f = new Float64Array(samples.length);
  for (let i = 0; i < samples.length; i++) f[i] = samples[i] / 32767;
  return f;
}

/** One-pole low-pass copy at cornerHz (non-destructive). */
function lowPassCopy(buf, cornerHz, sampleRate) {
  const out = new Float64Array(buf.length);
  const rc = 1 / (2 * Math.PI * cornerHz);
  const dt = 1 / sampleRate;
  const a = dt / (rc + dt);
  let y = buf.length ? buf[0] : 0;
  for (let i = 0; i < buf.length; i++) { y = y + a * (buf[i] - y); out[i] = y; }
  return out;
}

/** Frame-wise RMS energy. Returns { energy: Float64Array, hop, frameMs }. */
function frameRms(buf, sampleRate, frameMs = FRAME_MS) {
  const hop = Math.max(1, Math.round((frameMs / 1000) * sampleRate));
  const nFrames = Math.floor(buf.length / hop);
  const energy = new Float64Array(nFrames);
  for (let f = 0; f < nFrames; f++) {
    let s = 0;
    const base = f * hop;
    for (let i = 0; i < hop; i++) { const v = buf[base + i]; s += v * v; }
    energy[f] = Math.sqrt(s / hop);
  }
  return { energy, hop, frameMs };
}

/** Percentile of a copy-sorted array (q in [0,1]). */
function percentile(arr, q) {
  if (!arr.length) return 0;
  const a = Array.from(arr).sort((x, y) => x - y);
  const idx = Math.min(a.length - 1, Math.max(0, Math.round(q * (a.length - 1))));
  return a[idx];
}

/** Median of a slice [lo, hi). */
function medianSlice(arr, lo, hi) {
  const s = [];
  for (let i = Math.max(0, lo); i < Math.min(arr.length, hi); i++) s.push(arr[i]);
  if (!s.length) return 0;
  s.sort((x, y) => x - y);
  return s[s.length >> 1];
}

/**
 * Build the structure-region track from the broadband energy envelope by
 * global percentile thresholds, then enforce a minimum region dwell so the
 * track is coarse (THIN / BUILD / SUSTAIN regions, not per-frame chatter).
 */
function buildRegions(energy, frameMs, { thinFrac = 0.30, sustainFrac = 0.62, minRegionMs = 800, smoothMs = 500 } = {}) {
  // Classify on a SMOOTHED envelope, with thresholds as a FRACTION of the
  // track's loud reference (p85) — NOT raw percentiles. Percentile cut
  // points land INSIDE a cluster when the track is bimodal (e.g. a long
  // breakdown + a long full section), splitting that cluster at its own
  // median into T/B chatter; the short-run merge then collapses everything
  // into the first run's label. Fraction-of-loud thresholds put a real
  // breakdown firmly under thinThr and a full section firmly over susThr.
  const env = smooth(energy, Math.max(1, Math.round(smoothMs / frameMs)));
  const loudRef = percentile(env, 0.85);
  const thinThr = thinFrac * loudRef;
  const susThr = sustainFrac * loudRef;
  const cls = new Array(env.length);
  for (let i = 0; i < env.length; i++) {
    if (env[i] <= thinThr) cls[i] = 'THIN';
    else if (env[i] >= susThr) cls[i] = 'SUSTAIN';
    else cls[i] = 'BUILD';
  }
  // Run-length encode, then merge runs shorter than minRegionMs into the
  // previous region (coarsening).
  const minFrames = Math.max(1, Math.round(minRegionMs / frameMs));
  const runs = [];
  for (let i = 0; i < cls.length; i++) {
    const last = runs[runs.length - 1];
    if (last && last.label === cls[i]) last.end = i + 1;
    else runs.push({ start: i, end: i + 1, label: cls[i] });
  }
  // Absorb short runs into neighbours.
  const merged = [];
  for (const r of runs) {
    if (merged.length && (r.end - r.start) < minFrames) {
      merged[merged.length - 1].end = r.end;
    } else {
      merged.push({ ...r });
    }
  }
  return merged.map((r) => ({
    startMs: r.start * frameMs,
    endMs: r.end * frameMs,
    label: r.label,
  }));
}

/**
 * Centered moving-average smoothing of a frame series (window in frames).
 * Fills EVERY output index (a sliding sum that drops the tail would zero the
 * last `half` frames and force the track's tail to read as silence — a real
 * label-corruption bug). O(n·win); win is ~10-20 frames so this is cheap.
 */
function smooth(arr, win) {
  if (win <= 1) return Float64Array.from(arr);
  const out = new Float64Array(arr.length);
  const half = win >> 1;
  for (let i = 0; i < arr.length; i++) {
    const lo = Math.max(0, i - half);
    const hi = Math.min(arr.length - 1, i + half);
    let acc = 0;
    for (let k = lo; k <= hi; k++) acc += arr[k];
    out[i] = acc / (hi - lo + 1);
  }
  return out;
}

/**
 * Derive STRUCTURAL drops from the region track + the broadband energy
 * envelope, NON-CAUSALLY. A "drop" is the ONSET of a SUSTAIN region that
 * follows a lower (THIN/BUILD) region with a genuine broadband energy lift
 * that STAYS up — not a per-note bassline fluctuation and not a bass-only
 * entry. Coupling drops to the SUSTAIN onsets keeps drops CONSISTENT with
 * the region track (no "drop inside a THIN region" artifacts) and gives the
 * operationally useful definition: the moment the full mix slams in.
 *
 * @param regions   region track from buildRegions (broadband percentiles)
 * @param env       ~1 s-smoothed broadband energy envelope (frame series)
 * @param confirm   optional (frame)→bool gate (e.g. MUSDB bass+drums up);
 *                  a candidate drop must hold over most of the post window.
 */
function deriveDrops(regions, env, frameMs, opts = {}) {
  const {
    jumpRatio = 1.8,
    winMs = 2000,           // before/after comparison window
    beforeLowFrac = 0.55,   // preceding level must be below this·loudRef
    sustainFloorFrac = 0.60,
    confirm = null,
    confirmFrac = 0.6,
  } = opts;
  const loudRef = percentile(env, 0.85);
  if (loudRef <= 1e-9) return [];
  const sustainFloor = sustainFloorFrac * loudRef;
  const beforeCeil = beforeLowFrac * loudRef;
  const wF = Math.max(1, Math.round(winMs / frameMs));

  const drops = [];
  for (let ri = 1; ri < regions.length; ri++) {
    const r = regions[ri];
    const prev = regions[ri - 1];
    if (r.label !== 'SUSTAIN') continue;
    if (prev.label === 'SUSTAIN') continue;       // already loud → not a drop edge
    const onset = Math.round(r.startMs / frameMs);
    const before = medianSlice(env, onset - wF, onset);
    const after = medianSlice(env, onset, onset + wF);
    if (before <= 1e-9) continue;
    if (before > beforeCeil) continue;            // not coming from a real low section
    if (after < sustainFloor) continue;           // post-onset not genuinely full
    if (after / before < jumpRatio) continue;
    if (confirm) {
      let hits = 0, tot = 0;
      for (let f = onset; f < Math.min(env.length, onset + wF); f++) { tot++; if (confirm(f)) hits++; }
      if (tot === 0 || hits / tot < confirmFrac) continue;  // stems didn't engage
    }
    drops.push({ ts: r.startMs, score: after / before });
  }
  return drops;
}

/**
 * Label a single mixture track (FMA / any mono clip with no stems).
 * @param {{samples:Int16Array, sampleRate:number}} clip
 * @returns {{regions, drops, meta}}
 */
export function labelTrack(clip, opts = {}) {
  if (!clip || !clip.samples || !clip.samples.length) {
    throw new Error('labelTrack: empty clip');
  }
  const f = toFloat(clip.samples);
  const { energy: eFull, frameMs } = frameRms(f, clip.sampleRate);
  const regions = buildRegions(eFull, frameMs, opts.regions);
  const env = smooth(eFull, Math.max(1, Math.round(1000 / frameMs)));
  const drops = deriveDrops(regions, env, frameMs, opts.drops);
  return {
    regions,
    drops,
    meta: { source: 'mixture-energy', frameMs, nFrames: eFull.length },
  };
}

/**
 * Label a MUSDB track from its STEMS: drops where bass AND drums stems both
 * engage and sustain (independent of the mic mixture the detector reads).
 * Regions come from the mixture energy as in labelTrack. Also returns a
 * coarse per-region stem plan (mean stem RMS, normalized) for stems-fed
 * harness mode.
 *
 * @param {{mixture, bass, drums, vocals}} stems — each {samples, sampleRate}
 */
export function labelFromStems(stems, opts = {}) {
  for (const k of ['mixture', 'bass', 'drums']) {
    if (!stems[k] || !stems[k].samples || !stems[k].samples.length) {
      throw new Error(`labelFromStems: missing/empty stem '${k}'`);
    }
  }
  const sr = stems.mixture.sampleRate;
  const eMix = frameRms(toFloat(stems.mixture.samples), sr);
  const frameMs = eMix.frameMs;
  const bass = frameRms(toFloat(stems.bass.samples), sr).energy;
  const drums = frameRms(toFloat(stems.drums.samples), sr).energy;
  const vocals = stems.vocals && stems.vocals.samples.length
    ? frameRms(toFloat(stems.vocals.samples), sr).energy : new Float64Array(bass.length);

  // Regions from the mixture broadband energy; drops = SUSTAIN onsets where
  // the full mix lifts AND bass+drums stems both engage (the stem gate is
  // the independent, mic-invisible confirmation that this is a real drop,
  // not just a louder vocal/synth section).
  const bassN = normalize(bass);
  const drumsN = normalize(drums);
  const regions = buildRegions(eMix.energy, frameMs, opts.regions);
  const env = smooth(eMix.energy, Math.max(1, Math.round(1000 / frameMs)));
  const stemConfirm = (frame) => bassN[frame] > 0.4 && drumsN[frame] > 0.4;
  const drops = deriveDrops(regions, env, frameMs, { confirm: stemConfirm, ...(opts.drops || {}) });

  // Coarse per-region stem plan (mean normalized RMS over each region).
  const stemsPlan = regions.map((r) => {
    const lo = Math.floor(r.startMs / frameMs);
    const hi = Math.ceil(r.endMs / frameMs);
    return {
      startMs: r.startMs,
      endMs: r.endMs,
      bass: meanSlice(bassN, lo, hi),
      drums: meanSlice(drumsN, lo, hi),
      vocals: meanSlice(normalize(vocals), lo, hi),
    };
  });

  return { regions, drops, stemsPlan, meta: { source: 'stem-energy', frameMs, nFrames: bass.length } };
}

function normalize(arr) {
  let max = 0;
  for (let i = 0; i < arr.length; i++) if (arr[i] > max) max = arr[i];
  const out = new Float64Array(arr.length);
  if (max <= 1e-12) return out;
  for (let i = 0; i < arr.length; i++) out[i] = arr[i] / max;
  return out;
}

function meanSlice(arr, lo, hi) {
  let s = 0, n = 0;
  for (let i = Math.max(0, lo); i < Math.min(arr.length, hi); i++) { s += arr[i]; n++; }
  return n ? s / n : 0;
}
