/**
 * detector_scenarios.mjs — richer, fully-labeled synthetic scenarios for
 * the detection SCORING / EVAL harness (tools/detection_eval.mjs).
 *
 * WHY (separate from synth_dataset.mjs):
 *   synth_dataset.mjs's six clips are the REGRESSION guard — small, pinned,
 *   and asserted on hop-for-hop by audio_analysis_validation.test.mjs. We do
 *   NOT want to perturb that frozen set while super-tuning. This module adds
 *   LONGER, more musically realistic arcs (intro → build → drop → sustain →
 *   breakdown → second build → second drop, plus ambient / techno / false-
 *   build negatives) with KNOWN ground-truth event times, region labels, and
 *   a per-segment build-envelope reference so the eval can correlate the
 *   detector's buildScore against the real ramp.
 *
 * Each scenario is built on the SAME deterministic primitives as
 * synth_dataset.mjs (seeded mulberry32, renderClip), so its band/flux
 * signatures drive the REAL analyzer the same way, and every run is
 * byte-for-byte reproducible. No I/O here — the eval/runner writes audio.
 *
 * GROUND TRUTH per clip (in addition to the synth_dataset shape):
 *   labels.regions : [{ startMs, endMs, label }]  THIN|BUILD|SUSTAIN
 *   labels.drops   : [{ ts }]                      drop instants (ms)
 *   labels.slow    : [{ startMs, endMs }]          true low-energy/ambient zones
 *   labels.build   : [{ startMs, endMs, peakAtMs }] build ramps (for buildScore
 *                    correlation — the ramp should rise across [start,end] and
 *                    peak at peakAtMs ≈ the drop).
 *   stemsPlan      : as synth_dataset, for the stems-fed path.
 *
 * Honest scope (same caveat as synth_dataset): these are SYNTHETIC. They
 * validate the detector's PLUMBING + state machine + tuning against known
 * ground truth, degraded through the virtual playa mic. They do not
 * establish real-world EDM accuracy (which needs a human-labeled EDM corpus
 * — see skill 06 §9.5 and the detector Notion task).
 */

import { renderClip } from './synth_dataset.mjs';

const DEFAULT_SR = 44100;

// ── Per-segment synths (richer than synth_dataset's, parameterised) ───────

/** Near-silent ambient/breakdown — a low noise floor + a faint pad. */
function makeAmbientSynth({ level = 0.05, padHz = 220 } = {}) {
  return function ambient(t, p, rnd) {
    const pad = Math.sin(2 * Math.PI * padHz * t) * 0.012;
    return (rnd() * 2 - 1) * level * 0.18 + pad;
  };
}

/**
 * Steady loud full mix — sub + body + air. Pure-tone body (low flux) so a
 * sustain doesn't keep re-triggering BUILD. `fadeSec` ramps the onset so a
 * sustain start doesn't read as an infinite-slope drop edge.
 */
function makeFullMixSynth({ level = 0.82, fadeSec = 0 } = {}) {
  return function fullMix(t, p, rnd) {
    const sub  = Math.sin(2 * Math.PI * 60 * t) * 0.62;
    const body = Math.sin(2 * Math.PI * 300 * t) * 0.28;
    const air1 = Math.sin(2 * Math.PI * 8000 * t) * 0.18;
    const air2 = Math.sin(2 * Math.PI * 11000 * t) * 0.12;
    const fade = fadeSec > 0 ? (t < fadeSec ? t / fadeSec : 1) : 1;
    return (sub + body + air1 + air2) * level * fade;
  };
}

/**
 * Riser/build over the WHOLE segment: rising broadband noise + an upward
 * sweep tone (sustained positive flux → buildScore) PLUS a gently rising sub
 * (so micLow's energyRatio rises for > 1 s, the THIN→BUILD gate). The rise is
 * COMPOUNDING (constant per-hop ratio) so the build itself never trips the
 * windowed rate-of-change drop edge — only the sharp drop slam does.
 */
function makeBuildSynth({ amp0 = 0.08, amp1 = 0.62, subRamp = 0.10 } = {}) {
  return function build(t, p, rnd) {
    // smootherstep ramp — gentle, no hard corners.
    const u = p * p * (3 - 2 * p);
    const amp = amp0 + (amp1 - amp0) * u;
    const noise = (rnd() * 2 - 1);
    const sweep = Math.sin(2 * Math.PI * (2000 + 6000 * u) * t);
    const sub = Math.sin(2 * Math.PI * 60 * t) * subRamp * (0.3 + 0.7 * u);
    return (noise * 0.55 + sweep * 0.45) * amp + sub;
  };
}

/** Decaying build (false build): rises to a peak then fades, never drops. */
function makeDecayingBuildSynth({ ampPeak = 0.55, peakAt = 0.55 } = {}) {
  return function decaying(t, p, rnd) {
    const env = p < peakAt ? (p / peakAt) : Math.max(0, 1 - (p - peakAt) / (1 - peakAt));
    const amp = ampPeak * env;
    const noise = (rnd() * 2 - 1);
    const sweep = Math.sin(2 * Math.PI * (2000 + 6000 * Math.min(p, peakAt) / peakAt) * t);
    return (noise * 0.55 + sweep * 0.45) * amp;
  };
}

/**
 * Techno groove body — a steady, pumping full-spectrum loop (kick + sub +
 * hats). Higher per-hop flux than the pure-tone sustain, modelling a real
 * driving techno section: a robustness negative for the drop edge (must NOT
 * keep firing on a busy-but-steady body) AND a NOT-slow positive for the
 * slow-zone (a techno body is high-activity).
 */
function makeTechnoSynth({ bpm = 130, level = 0.7 } = {}) {
  return function techno(t, p, rnd) {
    const beatLen = 60 / bpm;
    const phase = (t % beatLen) / beatLen;
    // four-on-the-floor kick
    let kick = 0;
    if (phase < 0.18) {
      const hz = 90 - 45 * Math.min(1, phase / 0.18);
      kick = Math.sin(2 * Math.PI * hz * (phase * beatLen)) * Math.exp(-phase / 0.05) * 0.9;
    }
    const sub = Math.sin(2 * Math.PI * 55 * t) * 0.35;
    // 16th-note hats
    const sixteenth = beatLen / 4;
    const hphase = (t % sixteenth) / sixteenth;
    const hat = hphase < 0.2 ? (rnd() * 2 - 1) * Math.exp(-hphase / 0.06) * 0.3 : 0;
    return (kick + sub + hat) * level;
  };
}

// ── The labeled scenario catalog ──────────────────────────────────────────

/**
 * Build the full scenario set. Deterministic given the per-clip seeds.
 * @param {number} [sampleRate]
 * @returns {Array<object>} clips with the extended labels (regions/drops/slow/build).
 */
export function buildScenarios(sampleRate = DEFAULT_SR) {
  const clips = [];

  // Helper: assemble a clip + derive slow/build label tracks from the
  // segment list. A segment may carry `slow:true` (a true low-energy zone)
  // and `buildPeakNext:true` (this BUILD ramp peaks at the START of the next
  // segment, i.e. the drop).
  const make = (name, seed, segments) => {
    const clip = renderClip({ name, seed, sampleRate, segments });
    // Derive slow + build tracks from segment metadata + the rendered regions.
    const slow = [];
    const build = [];
    let cursorMs = 0;
    const segBounds = [];
    for (const seg of segments) {
      const startMs = cursorMs;
      const endMs = cursorMs + seg.durSec * 1000;
      segBounds.push({ seg, startMs, endMs });
      cursorMs = endMs;
    }
    for (let i = 0; i < segBounds.length; i++) {
      const { seg, startMs, endMs } = segBounds[i];
      if (seg.slow) slow.push({ startMs, endMs });
      if (seg.label === 'BUILD' && seg.realBuild) {
        // peak = start of the next segment if it is a drop, else seg end.
        const next = segBounds[i + 1];
        const peakAtMs = (next && next.seg.dropAtStart) ? next.startMs : endMs;
        build.push({ startMs, endMs, peakAtMs });
      }
    }
    clip.labels.slow = slow;
    clip.labels.build = build;
    return clip;
  };

  // 1) full_arc — the canonical EDM arc: intro → build → DROP → sustain →
  //    breakdown (slow) → build2 → DROP2 → outro sustain. Two real drops,
  //    two real build ramps, one true slow zone.
  clips.push(make('full_arc', 0xA101, [
    { name: 'intro',     durSec: 4.0, label: 'THIN',    slow: true,  synth: makeAmbientSynth({ level: 0.05 }) },
    { name: 'build1',    durSec: 6.0, label: 'BUILD',   realBuild: true, synth: makeBuildSynth({ amp0: 0.08, amp1: 0.62 }) },
    { name: 'drop1',     durSec: 7.0, label: 'SUSTAIN', dropAtStart: true,
      synth: makeFullMixSynth({ fadeSec: 0 }), stems: { bass: 0.85, drums: 0.85, vocals: 0.1 } },
    { name: 'breakdown', durSec: 5.0, label: 'THIN',    slow: true,  synth: makeAmbientSynth({ level: 0.06, padHz: 330 }),
      stems: { bass: 0.05, drums: 0.05, vocals: 0.4 } },
    { name: 'build2',    durSec: 5.0, label: 'BUILD',   realBuild: true, synth: makeBuildSynth({ amp0: 0.07, amp1: 0.6 }) },
    { name: 'drop2',     durSec: 7.0, label: 'SUSTAIN', dropAtStart: true,
      synth: makeFullMixSynth({ fadeSec: 0 }), stems: { bass: 0.85, drums: 0.85, vocals: 0.1 } },
  ]));

  // 2) single_drop_long — a single clean drop with a long build and a long
  //    sustain tail (latency + single-fire stress).
  clips.push(make('single_drop_long', 0xA202, [
    { name: 'intro',  durSec: 5.0, label: 'THIN',    slow: true,  synth: makeAmbientSynth({ level: 0.04 }) },
    { name: 'build',  durSec: 8.0, label: 'BUILD',   realBuild: true, synth: makeBuildSynth({ amp0: 0.07, amp1: 0.64 }) },
    { name: 'drop',   durSec: 10.0, label: 'SUSTAIN', dropAtStart: true,
      synth: makeFullMixSynth({ fadeSec: 0 }), stems: { bass: 0.86, drums: 0.86, vocals: 0.1 } },
  ]));

  // 3) ambient_long — a long calm/ambient passage. NEGATIVE for drops (zero),
  //    POSITIVE for slow-zone (should read slow throughout most of it).
  clips.push(make('ambient_long', 0xA303, [
    { name: 'pad', durSec: 18.0, label: 'THIN', slow: true, synth: makeAmbientSynth({ level: 0.05, padHz: 196 }),
      stems: { bass: 0.05, drums: 0.0, vocals: 0.2 } },
  ]));

  // 4) techno_steady — a long driving techno body, no drop structure.
  //    NEGATIVE for drops (must not false-fire on a busy steady body) AND
  //    NOT-slow (high activity → slow-zone must stay LOW).
  clips.push(make('techno_steady', 0xA404, [
    { name: 'lead', durSec: 2.0, label: 'THIN', slow: true, synth: makeAmbientSynth({ level: 0.05 }) },
    { name: 'body', durSec: 16.0, label: 'SUSTAIN', synth: makeTechnoSynth({ bpm: 130, level: 0.72 }),
      stems: { bass: 0.7, drums: 0.8, vocals: 0.0 } },
  ]));

  // 5) false_build_long — a build that decays without a drop. NEGATIVE for
  //    drops; the build ramp is real on the way up but there is no drop, so
  //    it is NOT registered as a build-correlation target (no realBuild).
  clips.push(make('false_build_long', 0xA505, [
    { name: 'intro',    durSec: 4.0, label: 'THIN',  slow: true, synth: makeAmbientSynth({ level: 0.05 }) },
    { name: 'decaying', durSec: 10.0, label: 'BUILD', synth: makeDecayingBuildSynth({ ampPeak: 0.55 }) },
    { name: 'outro',    durSec: 4.0, label: 'THIN',  slow: true, synth: makeAmbientSynth({ level: 0.05 }) },
  ]));

  // 6) sustain_then_slow — a loud sustain that drops out into a long quiet
  //    breakdown. The slow zone must engage cleanly on the breakdown and the
  //    step-DOWN must NOT be read as a drop.
  clips.push(make('sustain_then_slow', 0xA606, [
    { name: 'loud',  durSec: 10.0, label: 'SUSTAIN', synth: makeFullMixSynth({ fadeSec: 5.0 }),
      stems: { bass: 0.8, drums: 0.8, vocals: 0.1 } },
    { name: 'quiet', durSec: 8.0, label: 'THIN', slow: true, synth: makeAmbientSynth({ level: 0.04 }),
      stems: { bass: 0.05, drums: 0.0, vocals: 0.2 } },
  ]));

  // ── Adversarial additions (report 20260620_9: false-fire bait + recall holes).
  //    These are the cases the prior pass left as a documented gap; they
  //    measure BOTH false-fires on the bait AND recall on real-shaped drops.

  // 7) loud_intro_no_drop — a LOUD full mix from t=0 with NO preceding build
  //    (a DJ slamming straight into a banging track at the top of a set). The
  //    loud onset looks like a drop's energy slam, but no riser precedes it, so
  //    the build→drop transition gate MUST reject it. NEGATIVE for drops.
  clips.push(make('loud_intro_no_drop', 0xA707, [
    { name: 'slam', durSec: 16.0, label: 'SUSTAIN', synth: makeFullMixSynth({ fadeSec: 0 }),
      stems: { bass: 0.85, drums: 0.85, vocals: 0.1 } },
  ]));

  // 8) riser_no_drop — a long riser that builds tension and then resolves into
  //    a CALM breakdown WITHOUT a drop (a fake-out: the energy lifts, the
  //    buildScore climbs, then it deflates). A real build memory is present, so
  //    this is the hardest false-fire bait for the build-memory gate — there
  //    MUST be an actual energy slam, not just a recent build, to fire.
  //    NEGATIVE for drops.
  clips.push(make('riser_no_drop', 0xA808, [
    { name: 'intro',  durSec: 3.0, label: 'THIN',  slow: true, synth: makeAmbientSynth({ level: 0.05 }) },
    { name: 'riser',  durSec: 8.0, label: 'BUILD', synth: makeBuildSynth({ amp0: 0.07, amp1: 0.55 }) },
    { name: 'deflate', durSec: 7.0, label: 'THIN', slow: true, synth: makeAmbientSynth({ level: 0.05, padHz: 247 }) },
  ]));

  // 9) double_drop — two drops in quick succession (build → DROP → very short
  //    re-build → DROP2 ~4.5 s later). Tests that the eventRefractory does not
  //    swallow a legitimately-spaced second drop AND that a short re-build
  //    still arms the transition gate. POSITIVE (two labeled drops).
  clips.push(make('double_drop', 0xA909, [
    { name: 'intro',  durSec: 4.0, label: 'THIN',  slow: true, synth: makeAmbientSynth({ level: 0.05 }) },
    { name: 'build1', durSec: 5.0, label: 'BUILD', realBuild: true, synth: makeBuildSynth({ amp0: 0.08, amp1: 0.62 }) },
    { name: 'drop1',  durSec: 4.5, label: 'SUSTAIN', dropAtStart: true,
      synth: makeFullMixSynth({ fadeSec: 0 }), stems: { bass: 0.85, drums: 0.85, vocals: 0.1 } },
    { name: 'rebuild', durSec: 3.0, label: 'BUILD', realBuild: true, synth: makeBuildSynth({ amp0: 0.45, amp1: 0.66 }) },
    { name: 'drop2',  durSec: 7.0, label: 'SUSTAIN', dropAtStart: true,
      synth: makeFullMixSynth({ fadeSec: 0 }), stems: { bass: 0.86, drums: 0.86, vocals: 0.1 } },
  ]));

  // 10) breakdown_then_drop — a loud body → long quiet breakdown → second build
  //     → second drop, with the second drop landing AFTER an extended quiet
  //     section (the post-breakdown second drop the prior pass missed even at
  //     4.5 s spacing). POSITIVE (one labeled drop — the post-breakdown one;
  //     the opening body is a pre-rolled sustain, not a labeled drop instant).
  clips.push(make('breakdown_then_drop', 0xAA10, [
    { name: 'body',     durSec: 7.0, label: 'SUSTAIN', synth: makeFullMixSynth({ fadeSec: 4.0 }),
      stems: { bass: 0.8, drums: 0.8, vocals: 0.1 } },
    { name: 'breakdown', durSec: 7.0, label: 'THIN', slow: true, synth: makeAmbientSynth({ level: 0.05, padHz: 165 }),
      stems: { bass: 0.05, drums: 0.05, vocals: 0.4 } },
    { name: 'build2',   durSec: 5.0, label: 'BUILD', realBuild: true, synth: makeBuildSynth({ amp0: 0.07, amp1: 0.6 }) },
    { name: 'drop2',    durSec: 7.0, label: 'SUSTAIN', dropAtStart: true,
      synth: makeFullMixSynth({ fadeSec: 0 }), stems: { bass: 0.86, drums: 0.86, vocals: 0.1 } },
  ]));

  return clips;
}

export { makeBuildSynth, makeFullMixSynth, makeAmbientSynth, makeTechnoSynth };
