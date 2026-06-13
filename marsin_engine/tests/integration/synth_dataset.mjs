/**
 * synth_dataset.mjs — deterministic, seeded synthetic labeled-audio
 * generator for the audio-analysis integration harness.
 *
 * WHY SYNTHETIC (and not a real EDM corpus):
 *   The validation environment has NO ffmpeg and almost no outbound
 *   network (npm registry + raw.githubusercontent only; archive.org /
 *   freesound / zenodo / pixabay all 403). A real, open-license,
 *   drop-labeled EDM corpus is therefore unavailable here. Instead we
 *   synthesize clips whose BAND/FLUX SIGNATURES are built deliberately
 *   so the REAL analyzer (lib/audio_analyzer.js) produces the intended
 *   micLow / micHigh / micFlux trajectories, and we ship a ground-truth
 *   label track per clip. This validates the analysis PLUMBING and the
 *   detector's STATE MACHINE against known ground truth — it does NOT
 *   establish real-world EDM accuracy (see the report's "what this does
 *   NOT prove" section, and docs/30 Phase 3).
 *
 * Signal-design rationale (verified empirically against the real
 * analyzer — see the report's methodology section):
 *   - sub/bass energy  → a ~60 Hz sine drives micLow (and the kick
 *     band). micLow is what the detector's short/long energy envelopes
 *     and the drop's level-ratio edge are computed from.
 *   - build / riser    → rising-amplitude broadband noise + an upward
 *     sweep tone gives sustained positive micFlux (→ buildScore) AND a
 *     gently rising sub so micLow's energyRatio rises for > 1 s (the
 *     THIN→BUILD gate needs BOTH buildScore>thr and energyRatio rising).
 *   - drop             → a downbeat where the full-spectrum energy (and
 *     critically the SUB) jumps suddenly after the build, so micLow's
 *     short envelope spikes far above its long envelope → the detector's
 *     level-ratio dropEdge fires.
 *   - sustain          → steady loud full mix (sub + mid + highs).
 *   - thin/breakdown   → near-silence (low-amplitude noise floor).
 *
 * All randomness comes from a seeded mulberry32 PRNG so every run is
 * byte-for-byte reproducible. Audio is written to disk by the runner;
 * this module only generates samples + labels (no I/O), keeping it pure
 * and unit-testable.
 *
 * Output per clip:
 *   { name, sampleRate, samples: Int16Array, labels: { regions, drops } }
 *   regions: [{ startMs, endMs, label }]   label ∈ THIN|BUILD|SUSTAIN
 *   drops:   [{ ts }]                       ground-truth drop instants (ms)
 *   stemsPlan: [{ startMs, endMs, bass, drums, vocals }]  synthetic stem
 *     levels matching the labels, for the stems-fed harness mode.
 */

const DEFAULT_SR = 44100;

/** mulberry32 — tiny seeded PRNG (Tommy Ettinger, public domain). */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function f32ToI16(s) {
  if (s > 1) s = 1; else if (s < -1) s = -1;
  return Math.round(s * 32767);
}

/**
 * A clip is a list of segments. Each segment is rendered sample-by-sample
 * by a per-segment synth function `synth(t, localProgress, rnd)` returning
 * a float in [-1, 1]. `label` is the ground-truth structure class for the
 * region; `dropAtStart` marks the segment boundary as a labeled drop.
 *
 * @param {object} spec
 * @param {number} spec.seed
 * @param {number} [spec.sampleRate]
 * @param {Array<{name,durSec,label,synth,dropAtStart?,stems?}>} spec.segments
 */
function renderClip(spec) {
  const sampleRate = spec.sampleRate || DEFAULT_SR;
  const rnd = mulberry32(spec.seed);
  // Total length.
  let totalSamples = 0;
  for (const seg of spec.segments) totalSamples += Math.floor(sampleRate * seg.durSec);
  const samples = new Int16Array(totalSamples);

  const regions = [];
  const drops = [];
  const stemsPlan = [];

  let cursor = 0;
  let tGlobal = 0; // seconds since clip start
  for (const seg of spec.segments) {
    const n = Math.floor(sampleRate * seg.durSec);
    const startMs = (cursor / sampleRate) * 1000;
    for (let i = 0; i < n; i++) {
      const t = tGlobal + i / sampleRate;
      const p = n > 1 ? i / (n - 1) : 0;
      samples[cursor + i] = f32ToI16(seg.synth(t, p, rnd));
    }
    cursor += n;
    tGlobal += seg.durSec;
    const endMs = (cursor / sampleRate) * 1000;

    // Merge consecutive same-label regions for a clean label track.
    const lastRegion = regions[regions.length - 1];
    if (lastRegion && lastRegion.label === seg.label) {
      lastRegion.endMs = endMs;
    } else {
      regions.push({ startMs, endMs, label: seg.label });
    }
    if (seg.dropAtStart) drops.push({ ts: startMs });
    if (seg.stems) {
      stemsPlan.push({ startMs, endMs, ...seg.stems });
    } else {
      // Derive a default stem plan from the label so stems-fed mode has
      // something coherent even when a segment doesn't override it.
      stemsPlan.push({ startMs, endMs, ...defaultStemsFor(seg.label) });
    }
  }

  return { name: spec.name, sampleRate, samples, labels: { regions, drops }, stemsPlan };
}

/** Default synthetic stem levels per structure label. */
function defaultStemsFor(label) {
  if (label === 'SUSTAIN') return { bass: 0.8, drums: 0.8, vocals: 0.1 };
  if (label === 'BUILD')   return { bass: 0.2, drums: 0.3, vocals: 0.5 };
  return { bass: 0.05, drums: 0.05, vocals: 0.0 }; // THIN
}

// ── Per-segment synths ───────────────────────────────────────────────────

/** Near-silent breakdown — a low noise floor (THIN). */
function thinSynth(t, p, rnd) {
  return (rnd() * 2 - 1) * 0.008;
}

/**
 * Steady loud full mix — sub + body + stable highs, SUSTAIN/drop body.
 *
 * Deliberately PURE-TONE (no churning broadband noise): a real
 * post-drop sustain holds steady spectral content, so its per-hop
 * spectral FLUX is low. That matters because the detector's buildScore
 * is flux-driven — a noisy "steady" mix would keep re-triggering BUILD
 * (and, via the level-ratio gap, re-firing drops) every hop. The
 * harness's mic-only re-fire results (reported honestly) come precisely
 * from how hard it is to keep a loud body from looking like a build to a
 * level-ratio detector; the pure-tone body is the faithful "steady, no
 * transient" signal.
 */
function fullMixSynth(t, p, rnd) {
  const sub   = Math.sin(2 * Math.PI * 60 * t) * 0.62;
  const body  = Math.sin(2 * Math.PI * 300 * t) * 0.28;
  const air1  = Math.sin(2 * Math.PI * 8000 * t) * 0.18;
  const air2  = Math.sin(2 * Math.PI * 11000 * t) * 0.12;
  return (sub + body + air1 + air2) * 0.82;
}

/**
 * Steady loud mix with a `fadeSec` linear fade-in. The negative-control
 * `steady_loud` clip uses this so the loud section ramps in gradually
 * rather than stepping from digital silence — a hard step-from-zero
 * would spike the detector's short/long energy ratio (long envelope
 * τ=10 s lags badly) and fire ONE spurious drop on the onset. A real
 * "long loud SUSTAIN" is never an infinite-slope discontinuity; the
 * fade models that and is what makes the negative control fire ZERO on
 * the PRODUCT-DEFAULT detector config (verified — see the report).
 */
function makeSteadyFadeInSynth(fadeSec) {
  return function steadyFadeIn(t, p, rnd) {
    const fade = t < fadeSec ? t / fadeSec : 1;
    return fullMixSynth(t, p, rnd) * fade;
  };
}

/**
 * Riser/build: rising broadband noise + an upward sweep tone for
 * sustained positive flux, PLUS a gently rising sub so the detector's
 * micLow energyRatio rises for > 1 s (THIN→BUILD needs both). amp ramps
 * from `amp0` to `amp1` across the segment; sweep goes from 2 kHz to
 * 8 kHz. `subRamp` controls how much rising sub to fold in (kept modest
 * so it doesn't itself trip the drop level-ratio before the real drop).
 */
function makeRiserSynth({ amp0 = 0.1, amp1 = 0.7, subRamp = 0.10 } = {}) {
  return function riserSynth(t, p, rnd) {
    const amp = amp0 + (amp1 - amp0) * p;
    const noise = (rnd() * 2 - 1);
    const sweep = Math.sin(2 * Math.PI * (2000 + 6000 * p) * t);
    // Small, gently-rising sub so micLow climbs enough for the detector's
    // energyRatio to register "rising for > 1 s" (the THIN→BUILD gate) —
    // but kept modest so it doesn't itself slam the level-ratio drop edge
    // before the real drop. The mic-only premature-fire result (reported
    // honestly) is the residual of this tension: a level-ratio detector
    // cannot fully separate a rising build from a drop on micLow alone.
    const sub = Math.sin(2 * Math.PI * 60 * t) * subRamp * (0.3 + 0.7 * p);
    return (noise * 0.55 + sweep * 0.45) * amp + sub;
  };
}

/**
 * Decaying build (false build): a riser that RISES then FADES back to
 * near-silence without ever dropping. Flux stays positive on the way up
 * (so BUILD is entered) then collapses; the sub never slams in, so no
 * level-ratio drop edge ever fires.
 */
function makeDecayingRiserSynth({ ampPeak = 0.6 } = {}) {
  return function decayingRiser(t, p, rnd) {
    // Triangle envelope: rise to peak at p=0.55, fall after.
    const env = p < 0.55 ? (p / 0.55) : (1 - (p - 0.55) / 0.45);
    const amp = ampPeak * Math.max(0, env);
    const noise = (rnd() * 2 - 1);
    const sweep = Math.sin(2 * Math.PI * (2000 + 6000 * Math.min(p, 0.55) / 0.55) * t);
    return (noise * 0.55 + sweep * 0.45) * amp;
  };
}

// ── The labeled clip catalog ─────────────────────────────────────────────

/**
 * Build the full synthetic dataset. Deterministic given the per-clip
 * seeds baked in below.
 *
 * @returns {Array<ReturnType<typeof renderClip>>}
 */
export function buildDataset(sampleRate = DEFAULT_SR) {
  const clips = [];

  // 1) clean_drop — THIN → BUILD (riser) → DROP → SUSTAIN.
  //    Expect: detector walks THIN→BUILD→SUSTAIN and fires ONE dropFired
  //    at the riser→full-mix boundary.
  clips.push(renderClip({
    name: 'clean_drop', seed: 0x1111, sampleRate,
    segments: [
      { name: 'intro_thin', durSec: 3.0, label: 'THIN',  synth: thinSynth },
      { name: 'riser',      durSec: 5.0, label: 'BUILD', synth: makeRiserSynth({ amp0: 0.1, amp1: 0.7 }) },
      { name: 'drop_body',  durSec: 6.0, label: 'SUSTAIN', synth: fullMixSynth, dropAtStart: true,
        stems: { bass: 0.85, drums: 0.85, vocals: 0.1 } },
    ],
  }));

  // 2) false_build — a BUILD that decays without a drop.
  //    Expect: NO dropFired. Detector resolves BUILD→SUSTAIN (false
  //    build) or BUILD→THIN. The riser never hands off to a sub slam.
  clips.push(renderClip({
    name: 'false_build', seed: 0x2222, sampleRate,
    segments: [
      { name: 'intro_thin', durSec: 3.0, label: 'THIN',  synth: thinSynth },
      // Long enough (>6 s) that the "false build" timeout can resolve it.
      { name: 'decaying',   durSec: 9.0, label: 'BUILD', synth: makeDecayingRiserSynth({ ampPeak: 0.6 }) },
      { name: 'outro_thin', durSec: 3.0, label: 'THIN',  synth: thinSynth },
    ],
  }));

  // 3) collapse — BUILD that collapses to THIN before any drop.
  //    Expect: NO dropFired. A short riser then an abrupt return to
  //    near-silence (energy low for > 1 s → BUILD→THIN collapse).
  clips.push(renderClip({
    name: 'collapse', seed: 0x3333, sampleRate,
    segments: [
      { name: 'intro_thin', durSec: 3.0, label: 'THIN',  synth: thinSynth },
      { name: 'short_riser', durSec: 3.0, label: 'BUILD', synth: makeRiserSynth({ amp0: 0.1, amp1: 0.55 }) },
      { name: 'collapse_thin', durSec: 5.0, label: 'THIN', synth: thinSynth },
    ],
  }));

  // 4) double_drop — two drops ~8 s apart. Both should fire (each clears
  //    the 2 s refractory); verify timing.
  clips.push(renderClip({
    name: 'double_drop', seed: 0x4444, sampleRate,
    segments: [
      { name: 'intro_thin',  durSec: 3.0, label: 'THIN',  synth: thinSynth },
      { name: 'riser_1',     durSec: 4.0, label: 'BUILD', synth: makeRiserSynth({ amp0: 0.1, amp1: 0.7 }) },
      { name: 'drop_1',      durSec: 4.0, label: 'SUSTAIN', synth: fullMixSynth, dropAtStart: true,
        stems: { bass: 0.85, drums: 0.85, vocals: 0.1 } },
      // Breakdown between the two drops so the second build is a real
      // THIN→BUILD→drop cycle (~8 s after the first drop).
      { name: 'mid_thin',    durSec: 2.0, label: 'THIN',  synth: thinSynth },
      { name: 'riser_2',     durSec: 4.0, label: 'BUILD', synth: makeRiserSynth({ amp0: 0.1, amp1: 0.7 }) },
      { name: 'drop_2',      durSec: 5.0, label: 'SUSTAIN', synth: fullMixSynth, dropAtStart: true,
        stems: { bass: 0.85, drums: 0.85, vocals: 0.1 } },
    ],
  }));

  // 5) steady_loud — a long loud SUSTAIN with no build, no transient.
  //    NEGATIVE CONTROL: zero dropFired (no riser, no level-ratio edge —
  //    the long envelope converges to the loud level so no jump occurs).
  clips.push(renderClip({
    name: 'steady_loud', seed: 0x5555, sampleRate,
    segments: [
      // 6 s fade-in (so no hard onset spikes the energy ratio) then hold.
      { name: 'loud', durSec: 18.0, label: 'SUSTAIN', synth: makeSteadyFadeInSynth(6.0),
        stems: { bass: 0.8, drums: 0.8, vocals: 0.1 } },
    ],
  }));

  // 6) silence — all-zero. NEGATIVE CONTROL: no state change, no fire,
  //    no NaN.
  clips.push(renderClip({
    name: 'silence', seed: 0x6666, sampleRate,
    segments: [
      { name: 'silent', durSec: 8.0, label: 'THIN', synth: () => 0 },
    ],
  }));

  return clips;
}

export { renderClip, mulberry32 };
