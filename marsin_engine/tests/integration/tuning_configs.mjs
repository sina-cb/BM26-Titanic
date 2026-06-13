/**
 * tuning_configs.mjs — the candidate tuning scenarios the corpus sweep
 * compares, in ONE reviewable place. Each scenario is a full spec:
 *   { detectorConfig, chainsOverride, bands, kick }
 * where omitted fields fall back to the product defaults.
 *
 * Keeping the candidate constants here (rather than scattered in the sweep)
 * makes the eventual product changes traceable: the values that win the
 * sweep are the values that land in lib/signal_post_processor.js
 * (DEFAULT_CHAINS), marsin_engine/config.yaml (audio.bands / audio.kick),
 * and lib/audio_structure_detector.js (DETECTOR_DEFAULTS).
 *
 * SEPARATION OF TRACKS (see the corpus-tuning report):
 *   - chainsOverride → pattern-facing FEEL (what the lights react to). Does
 *     NOT affect the detector (it reads the raw pre-chain mirrors).
 *   - detectorConfig → drop/structure ACCURACY (reads raw mirrors).
 *   - bands / kick   → analyzer front-end (affects BOTH).
 */

import { DEFAULT_BANDS, DEFAULT_KICK } from './run_analysis.mjs';

// ── TUNED pattern-facing chains (Task C) ──────────────────────────────────
// The non-kick signals ship with a GAIN op ONLY (no smoothing) → they
// flicker. We add a one-pole lpf tuned to each signal's musical character:
// sub/bass slow & smooth, hats livelier, flux a gentle build glow. The kick
// stays SUDDEN — short envelope release + tight schmitt + short hold decay,
// no long smear.
export const TUNED_CHAINS = {
  micLow: [
    { id: 'low_gain', type: 'gain', enabled: true, params: { paramKey: 'micLowGain' } },
    { id: 'low_lpf',  type: 'lpf',  enabled: true, params: { cutoffHz: 3.5 } },
  ],
  micMid: [
    { id: 'mid_gain', type: 'gain', enabled: true, params: { paramKey: 'micMidGain' } },
    { id: 'mid_lpf',  type: 'lpf',  enabled: true, params: { cutoffHz: 5.5 } },
  ],
  micHigh: [
    { id: 'high_gain', type: 'gain', enabled: true, params: { paramKey: 'micHighGain' } },
    { id: 'high_lpf',  type: 'lpf',  enabled: true, params: { cutoffHz: 10.0 } },
  ],
  micFlux: [
    { id: 'flux_gain', type: 'gain', enabled: true, params: { paramKey: 'micFluxGain' } },
    { id: 'flux_lpf',  type: 'lpf',  enabled: true, params: { cutoffHz: 4.5 } },
  ],
  // SUDDEN kick: faster attack, much shorter release (180→60 ms), tighter
  // schmitt refractory, short hold decay (120→60 ms). No long release smear.
  micKick: [
    { id: 'kick_gain',     type: 'gain',     enabled: true, params: { paramKey: 'micKickGain' } },
    { id: 'kick_envelope', type: 'envelope', enabled: true, params: { attackMs: 5, releaseMs: 60 } },
    { id: 'kick_schmitt',  type: 'schmitt',  enabled: true, params: { tHigh: 0.5, tLow: 0.3, refractoryMs: 120 } },
    { id: 'kick_hold',     type: 'hold',     enabled: true, params: { timeoutMs: 60, decayMs: 60 } },
  ],
  // Stems → patterns: bass smooth, drums snappy, vocals smooth. (Detector
  // reads stems*Raw, so this is feel-only.)
  stemsBass:   [{ id: 'stems_bass_gain',   type: 'gain', enabled: true, params: { paramKey: 'stemsBassGain' } },   { id: 'stems_bass_lpf',   type: 'lpf', enabled: true, params: { cutoffHz: 3.5 } }],
  stemsDrums:  [{ id: 'stems_drums_gain',  type: 'gain', enabled: true, params: { paramKey: 'stemsDrumsGain' } },  { id: 'stems_drums_lpf',  type: 'lpf', enabled: true, params: { cutoffHz: 12.0 } }],
  stemsVocals: [{ id: 'stems_vocals_gain', type: 'gain', enabled: true, params: { paramKey: 'stemsVocalsGain' } }, { id: 'stems_vocals_lpf', type: 'lpf', enabled: true, params: { cutoffHz: 5.0 } }],
};

// ── TUNED analyzer front-end (Task D) ─────────────────────────────────────
// MEASURED OUTCOME: leave the analyzer front-end at its defaults.
//   noiseGate stays 0.04 — at the typical (moderate) mic tier the low-band
//   noise floor is ≈0.021, already well under 0.04. Raising the gate to
//   0.05+ to chase the EXTREME heavy-tier floor (≈0.050) is NET NEGATIVE:
//   it collapses detector recall at the moderate tier (the detector reads
//   the post-gate micLowRaw, so the gate eats the build-up energy) — see
//   report §Task D per-tier table. The heavy-room floor is the normalizer
//   (AGC) op's job, not a single static gate.
//   kick.threshold stays 1.8 — ZERO false kicks from mic noise at 1.8 (the
//   50-110 Hz band + EMA-relative onset test reject broadband noise);
//   raising it only costs real-kick sensitivity.
export const TUNED_BANDS = { ...DEFAULT_BANDS };
export const TUNED_KICK  = { ...DEFAULT_KICK };

// ── TUNED detector (Task E) ───────────────────────────────────────────────
// windowed-delta drop edge. Refractory stays at the shipped 2000 ms: the
// rising-tracker reset on SUSTAIN entry structurally prevents in-body
// re-fires, so a longer refractory is no longer needed (and 2000 keeps
// recall on genuinely close double-drops).
export const TUNED_DETECTOR = {
  dropEdgeMode: 'windowed',
  dropDeltaWindowMs: 400,
  eventRefractoryMs: 2000,
};

export const SCENARIOS = {
  // The ORIGINALLY-shipped defaults (level edge, 2 s refractory), pinned
  // explicitly so this comparison stays valid even after DETECTOR_DEFAULTS
  // is flipped to 'windowed'.
  baseline: { detectorConfig: { dropEdgeMode: 'level', eventRefractoryMs: 2000 }, chainsOverride: null, bands: DEFAULT_BANDS, kick: DEFAULT_KICK },
  // Isolate the FEEL change (chains only).
  feel: { detectorConfig: {}, chainsOverride: TUNED_CHAINS, bands: DEFAULT_BANDS, kick: DEFAULT_KICK },
  // Isolate the DETECTOR change (windowed edge only).
  detector: { detectorConfig: TUNED_DETECTOR, chainsOverride: null, bands: DEFAULT_BANDS, kick: DEFAULT_KICK },
  // Everything tuned together (the candidate product config).
  tuned: { detectorConfig: TUNED_DETECTOR, chainsOverride: TUNED_CHAINS, bands: TUNED_BANDS, kick: TUNED_KICK },
};
