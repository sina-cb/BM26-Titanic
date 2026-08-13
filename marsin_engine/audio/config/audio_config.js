/**
 * Audio config — load / merge / save the operator-tunable subset of
 * the `audio:` block from config.yaml on top of an optional
 * `audio_config.yaml` that holds runtime overrides set via the
 * Audio Analysis tab in CaptainPad.
 *
 * Why a separate file (vs. amending config.yaml in place):
 *   - config.yaml is hand-edited by operators between shows;
 *     rewriting it from the engine would clobber comments, ordering
 *     and unrelated edits.
 *   - audio_config.yaml is the engine's own scratch space, written
 *     debounced when PATCH /audio/config succeeds. Missing file =
 *     fall back to the config.yaml defaults.
 *
 * Two distinct subsets:
 *
 *   AUDIO_LIVE_FIELDS — bands + kick. Can be PATCH'd from CaptainPad
 *     and applied without restarting the capture stream
 *     (analyzer.reconfigure handles them in place).
 *
 *   AUDIO_SCENE_FIELDS — everything that travels with a scene's
 *     state file: enabled, fftSize, hopSize, plus the live fields.
 *     Capture (mic device) is NOT here — that's machine-local.
 *
 * Why split:
 *   - Bands/kick can be retuned mid-show; they're hot-reloadable.
 *   - enabled / fftSize / hopSize require analyzer reconstruction
 *     and ideally an engine restart. They're saved with the scene
 *     so opening it on a different rig gives consistent behaviour,
 *     but the REST PATCH endpoint only accepts the live subset.
 */

import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';

import {
  DERIVED_SIGNALS_LIVE_FIELDS,
  validateDerivedSignalsPatch,
} from './derived_signals_config.js';

// `bands` lost `smoothingAlpha` (2026-05-25) in favour of asymmetric
// `attackMs`/`releaseMs` + a `noiseGate` floor. See audio_analyzer.js
// header for the engineering rationale. Per codex P0 "no fallback
// behaviors", the analyzer rejects a `bands` payload that's missing
// any of these — config.yaml supplies them at boot.
export const AUDIO_LIVE_FIELDS = Object.freeze({
  // lowGate/midGate/highGate (on-playa hardening, report 20260621_4): PER-BAND
  // noise gates. The single global `noiseGate` is the gate for every band that
  // does NOT specialize one of these. On a loud/dusty/windy night the ambient
  // bed lights the bands unevenly — measured: the HIGH band reads ~0.17 and MID
  // ~0.07 from pure noise (capsule hiss + wind), while the global gate sits at
  // 0.04, so mid/high stay lit during silence/breakdowns. Raising the global
  // gate would also kill quiet musical hats; a per-band gate lets the operator
  // set highGate≈0.18 / midGate≈0.08 (from tools/audio_calibrate.js, which
  // measures exactly these post-compress per-band floors) WITHOUT dimming the
  // low band. Absent → that band uses the global noiseGate (so the shipped
  // config, which sets none, is byte-identical to the legacy single-gate path).
  bands: ['lowMaxHz', 'midMaxHz', 'attackMs', 'releaseMs', 'noiseGate', 'inputGain', 'sourceSmoothHz',
    'lowGate', 'midGate', 'highGate'],
  kick:  ['minHz', 'maxHz', 'threshold', 'refractoryMs', 'decayMs'],
  // analyzer_features (slot 3): sub-bass "chest hit" window (~30–60 Hz). Live-
  // tunable like kick; analyzer.reconfigure rebinds the sub bin in place.
  sub:   ['minHz', 'maxHz'],
  // bpmTracker — ONLY the published-BPM slew. The detector's band, evidence
  // and silence knobs shape the tempo model itself and stay config-only (a
  // mid-show change there re-shapes the lock); the slew is a pure output
  // smoother the operator legitimately trims while the lights run.
  bpmTracker: ['outputSlewEnabled', 'outputSlewBpmPerSec'],
  // structureDetector — audio build/drop/sustain detector (docs/30).
  // Disabled by default; the detector module is instantiated at boot
  // regardless (so its surface exists) but `tick()` no-ops until the
  // operator flips `enabled:true` via PATCH /audio/config. `enabled`
  // is a boolean; the remaining fields are the core numeric thresholds
  // (docs/30 §Phase 4 names a superset — we land the ones the Phase 1
  // state machine actually reads).
  structureDetector: [
    'enabled', 'buildThreshold', 'dropEnergyJump', 'dropEdgeMode', 'dropDeltaWindowMs',
    'dropMinLevel', 'dropLevelAssist', 'dropBuildGate', 'dropBuildMemoryMs',
    'dropSlowZoneMax', 'dropBuildRise', 'dropNoveltyRatio', 'dropNoveltyWindowMs', 'dropRelLevel',
    'dropNisThreshold', 'dropKalmanQ', 'dropCoWindowMs',
    'slowZoneRef', 'slowZoneWidth', 'slowFluxFloor',
    'stemsTimeoutMs', 'eventRefractoryMs', 'falseFireCount', 'falseFireWindowMs', 'falseFireQuietMs',
  ],
});

/**
 * String-enum live fields (the only non-numeric, non-boolean group fields).
 * dropEdgeMode selects the drop discriminator (see audio_structure_detector
 * DETECTOR_DEFAULTS). Validated as an exact-match enum; anything else 400s.
 */
/**
 * Boolean live group fields (besides the top-level `enabled` toggle). These
 * are validated as strict booleans, NOT numbers. dropLevelAssist toggles the
 * windowed drop edge's level-ratio assist (see audio_structure_detector
 * DETECTOR_DEFAULTS).
 */
const LIVE_BOOLEAN_FIELDS = Object.freeze({
  structureDetector: Object.freeze(['enabled', 'dropLevelAssist']),
  bpmTracker: Object.freeze(['outputSlewEnabled']),
});

const LIVE_STRING_ENUMS = Object.freeze({
  structureDetector: Object.freeze({
    // 'windowed' (DEFAULT) — rate-of-change discriminator; the corpus-validated
    // product default. 'kalman' is OPT-IN (Kalman+NIS on micLow ∧ micFlux); its
    // shipped tuning under-fires on the corpus (pending re-tune via dropKalmanQ
    // / dropCoWindowMs), so it is not the default. 'level' kept for back-compat.
    dropEdgeMode: ['level', 'windowed', 'kalman'],
  }),
});

/**
 * Per-field validation rules for nested live-tunable groups. Each
 * entry receives the numeric value and returns null on success or a
 * human-readable error suffix on failure (the caller prefixes
 * `"<group>.<field>": `). Centralised here (vs. inside the analyzer)
 * so PATCH /audio/config can 400 cleanly before reaching the engine
 * core, AND so the analyzer can re-run the same checks defensively on
 * its boot path. No silent fallbacks (codex P0): every field validated
 * explicitly with the documented range, integer-ness, etc.
 */
const LIVE_FIELD_VALIDATORS = Object.freeze({
  // structureDetector (docs/30). `enabled` is boolean — validated by
  // the boolean branch in validateLivePatch, NOT here (these validators
  // only fire on numeric fields). The numeric thresholds gate the
  // build/drop/sustain state machine; ranges chosen per the doc's
  // pseudocode defaults (buildScore∈[0,1] threshold, energyJump > 1×,
  // freshness/refractory in ms).
  bands: Object.freeze({
    // Software input gain (mic-preamp). 0 = mute, 1 = unity, up to 64×.
    inputGain: (v) => (v >= 0 && v <= 64) ? null : `must be in [0, 64]; got ${v}`,
    // Source-stage smoothing LP cutoff (Hz); 0 = off. Up to ~Nyquist.
    sourceSmoothHz: (v) => (v >= 0 && v <= 22050) ? null : `must be in [0, 22050]; got ${v}`,
    // Per-band noise gates (on-playa hardening). Same [0, 1) post-compression
    // domain as the global noiseGate — a band value at/below its gate reads 0,
    // values above are rescaled to use the full range above it. Each OPTIONAL;
    // an absent band-gate uses the global noiseGate.
    lowGate:  (v) => (v >= 0 && v < 1) ? null : `must be in [0, 1); got ${v}`,
    midGate:  (v) => (v >= 0 && v < 1) ? null : `must be in [0, 1); got ${v}`,
    highGate: (v) => (v >= 0 && v < 1) ? null : `must be in [0, 1); got ${v}`,
  }),
  // Published-BPM slew rate. Must be > 0 — a zero rate would freeze the
  // published tempo forever instead of smoothing it. The ceiling is well past
  // "instant" at the ~86 Hz hop rate, so the operator can effectively disable
  // the walk from the top of the range too.
  bpmTracker: Object.freeze({
    outputSlewBpmPerSec: (v) => (v > 0 && v <= 240) ? null : `must be in (0, 240]; got ${v}`,
  }),
  // analyzer_features (slot 3): sub-bass window edges (Hz). Validated like the
  // kick window — both positive, below Nyquist; the analyzer enforces min<max.
  sub: Object.freeze({
    minHz: (v) => (v > 0 && v <= 22050) ? null : `must be in (0, 22050]; got ${v}`,
    maxHz: (v) => (v > 0 && v <= 22050) ? null : `must be in (0, 22050]; got ${v}`,
  }),
  structureDetector: Object.freeze({
    buildThreshold:    (v) => (v >= 0 && v <= 1) ? null : `must be in [0, 1]; got ${v}`,
    dropEnergyJump:    (v) => (v > 1.0 && v <= 10.0) ? null : `must be in (1.0, 10.0]; got ${v}`,
    dropDeltaWindowMs: (v) => (v >= 50 && v <= 5000) ? null : `must be in [50, 5000]; got ${v}`,
    // Absolute sub-energy floor a drop's short-envelope must reach (rejects
    // near-silent build noise-ratio false edges). 0 disables; ≤1 (micLow domain).
    dropMinLevel:      (v) => (v >= 0 && v <= 1) ? null : `must be in [0, 1]; got ${v}`,
    // Build→drop transition gate: the recent buildScore peak (within
    // dropBuildMemoryMs) required for the windowed/level edge to fire from THIN.
    // 0 reverts to the BUILD-state-only edge. Real drops carry ≥0.74, bare
    // loud-body onsets ≤0.22, so ~0.5 separates them.
    dropBuildGate:     (v) => (v >= 0 && v <= 1) ? null : `must be in [0, 1]; got ${v}`,
    dropBuildMemoryMs: (v) => (v >= 0 && v <= 30000) ? null : `must be in [0, 30000]; got ${v}`,
    // The build-memory THIN-firing edge only fires when slowZone < this (rejects
    // a build's onset out of a breakdown). [0,1]; 1 disables the slow-zone gate.
    dropSlowZoneMax:   (v) => (v >= 0 && v <= 1) ? null : `must be in [0, 1]; got ${v}`,
    // P0-1 drop-edge music-shape gates (report 20260620_23) — applied to BOTH
    // the THIN build-mem edge and the BUILD-state edge. dropBuildRise: the
    // buildScore rise (peak−trough over dropBuildMemoryMs) a real build must
    // show — rejects busy music's flat high plateau. dropNoveltyRatio: the
    // firing windowed ratio must outlier this × above the recent median ratio —
    // rejects routine busy-music transients. Both 0 = disabled (revert).
    dropBuildRise:     (v) => (v >= 0 && v <= 1) ? null : `must be in [0, 1]; got ${v}`,
    dropNoveltyRatio:  (v) => (v >= 0 && v <= 50) ? null : `must be in [0, 50]; got ${v}`,
    dropNoveltyWindowMs: (v) => (v >= 0 && v <= 60000) ? null : `must be in [0, 60000]; got ${v}`,
    // Mic-gain-relative drop floor factor: effective floor =
    // max(dropMinLevel, dropRelLevel · runningLoudnessRef). 0 → pure absolute
    // floor; ≤1 keeps it below the loud-passage level.
    dropRelLevel:      (v) => (v >= 0 && v <= 1) ? null : `must be in [0, 1]; got ${v}`,
    // Kalman+NIS drop gate (χ² statistic). 6.63 = χ²₁ 99%; tune sensitivity
    // here (lower → more sensitive). slowZoneRef = the activity level
    // (max of micLow/micFlux) at/below which we read as a "slow zone".
    dropNisThreshold:  (v) => (v > 1.0 && v <= 100.0) ? null : `must be in (1.0, 100.0]; got ${v}`,
    // Kalman-edge process noise — LOW so adaptive R sets the NIS scale (a high Q
    // floors S and the detector can't reach the gate; that was the under-fire bug).
    dropKalmanQ:       (v) => (v > 0 && v <= 1) ? null : `must be in (0, 1]; got ${v}`,
    // Kalman-edge co-occurrence window: low & flux NIS may clear within this many ms.
    dropCoWindowMs:    (v) => (v >= 0 && v <= 2000) ? null : `must be in [0, 2000]; got ${v}`,
    slowZoneRef:       (v) => (v > 0 && v <= 1) ? null : `must be in (0, 1]; got ${v}`,
    // Slow-zone soft-knee half-width (activity domain). 0 → a hard step at ref.
    slowZoneWidth:     (v) => (v >= 0 && v <= 1) ? null : `must be in [0, 1]; got ${v}`,
    // Mic flux floor discounted from slow-zone activity (rejects capsule/room
    // flux noise so ambient reads calm). 0 → count all flux as activity.
    slowFluxFloor:     (v) => (v >= 0 && v <= 1) ? null : `must be in [0, 1]; got ${v}`,
    stemsTimeoutMs:    (v) => (v >= 0 && v <= 60000) ? null : `must be in [0, 60000]; got ${v}`,
    eventRefractoryMs: (v) => (v >= 0 && v <= 60000) ? null : `must be in [0, 60000]; got ${v}`,
    falseFireCount:    (v) => (Number.isInteger(v) && v >= 1 && v <= 100)
                              ? null : `must be an integer in [1, 100]; got ${v}`,
    falseFireWindowMs: (v) => (v >= 0 && v <= 600000) ? null : `must be in [0, 600000]; got ${v}`,
    falseFireQuietMs:  (v) => (v >= 0 && v <= 600000) ? null : `must be in [0, 600000]; got ${v}`,
  }),
});

/**
 * Capture fields the operator can change from the iPad (mic picker).
 * Changing any of these triggers a capture-stream restart in the
 * engine — analyzer.reconfigure can't swap mics, so applyLiveUpdate
 * tears down ffmpeg and respawns with the new device.
 *
 * Why these and not e.g. sampleRate: changing sampleRate would also
 * require rebuilding the analyzer (FFT bin map, kick filter) — out of
 * scope for the iPad surface; keep it in config.yaml + restart.
 */
export const AUDIO_LIVE_CAPTURE_FIELDS = Object.freeze([
  'device', 'deviceLabel', 'deviceId', 'inputFormat', 'platform',
]);

/** Top-level scalars the operator can flip live from the iPad. */
export const AUDIO_LIVE_TOPLEVEL_FIELDS = Object.freeze(['enabled']);

/**
 * Scalar (non-nested) fields persisted per-scene alongside the live
 * groups. Saved on every PATCH so a CaptainPad tweak immediately
 * follows the scene. `capture` is intentionally NOT included — it
 * lives per-machine in audio_config.yaml.
 */
export const AUDIO_SCENE_SCALARS = Object.freeze(['enabled', 'fftSize', 'hopSize']);

const AUDIO_OVERRIDE_FILE = 'audio_config.yaml';

/**
 * Read the optional audio_config.yaml overrides. Missing file → `{}` (a rig
 * that never overrode anything). A PARSE failure THROWS with the path (codex
 * P0): same reasoning as loadSceneAudio — every caller reads to merge and
 * write back, so "recovering" to `{}` overwrites the operator's file with
 * defaults instead of telling them it's broken.
 */
export function loadAudioConfig(engineDir) {
  const p = path.join(engineDir, AUDIO_OVERRIDE_FILE);
  if (!fs.existsSync(p)) return {};
  let obj;
  try {
    obj = yaml.load(fs.readFileSync(p, 'utf8'));
  } catch (err) {
    throw new Error(`failed to parse ${p}: ${err.message} — fix or delete the file`);
  }
  return (obj && typeof obj === 'object') ? obj : {};
}

/** Atomically write audio_config.yaml from the live-tunable subset. */
export function saveAudioConfig(engineDir, livePartial) {
  const p   = path.join(engineDir, AUDIO_OVERRIDE_FILE);
  const tmp = `${p}.tmp`;
  const header = '# Auto-written by MarsinEngine on PATCH /audio/config.\n' +
                 '# Do not hand-edit while the engine is running — use the\n' +
                 '# Audio Analysis tab in CaptainPad, or the REST endpoint.\n';
  try {
    fs.writeFileSync(tmp, header + yaml.dump(livePartial, { sortKeys: false }));
    fs.renameSync(tmp, p);
  } catch (err) {
    console.warn(`[audio_config] failed to write ${AUDIO_OVERRIDE_FILE}: ${err.message}`);
  }
}

/**
 * Deep-merge config.yaml's `audio:` block with the runtime override
 * file, then with any in-flight partial PATCH. Later args win. Only
 * known scalar fields are merged — nested unknown structures are
 * dropped to keep the shape predictable.
 */
export function mergeAudioConfig(...layers) {
  const out = {};
  for (const layer of layers) {
    if (!layer || typeof layer !== 'object') continue;
    for (const [k, v] of Object.entries(layer)) {
      if (k === 'derivedSignals' && v && typeof v === 'object' && !Array.isArray(v)) {
        const current = out.derivedSignals || {};
        const merged = { ...current };
        for (const [group, values] of Object.entries(v)) {
          if (values && typeof values === 'object' && !Array.isArray(values)) {
            merged[group] = { ...(current[group] || {}), ...values };
          } else {
            merged[group] = values;
          }
        }
        out.derivedSignals = merged;
      } else if (v && typeof v === 'object' && !Array.isArray(v)) {
        out[k] = { ...(out[k] || {}), ...v };
      } else if (v !== undefined) {
        out[k] = v;
      }
    }
  }
  return out;
}

/**
 * Project a full audio config down to the per-scene subset:
 *   - top-level scalars: enabled, fftSize, hopSize
 *   - nested groups:     bands, kick (live-tunable)
 *
 * This is what gets serialized into states/<scene>/audio_state.yaml on
 * every PATCH /audio/config so the scene file always reflects current
 * truth. Capture is excluded — that's per-machine.
 *
 * `derivedSignals` is DELIBERATELY NOT projected wholesale. The merged
 * config always carries the COMPLETE tree (config.yaml supplies every
 * group), so persisting all of it stamped a full copy of config.yaml's
 * derived tuning into the scene state on the very first knob turn — and
 * from then on the scene file SHADOWED every future config.yaml retune,
 * permanently and invisibly. Instead the caller passes
 * `opts.derivedSignalsGroups`: the groups actually live-patched THIS
 * runtime. Only those are persisted, and only their live-tunable fields —
 * everything the operator did not touch keeps deferring to config.yaml.
 *
 * @param {object} cfg  merged audio config
 * @param {{derivedSignalsGroups?: Iterable<string>}} [opts]
 */
export function pickLiveFields(cfg, opts = {}) {
  const out = {};
  for (const k of AUDIO_SCENE_SCALARS) {
    if (cfg && cfg[k] !== undefined) out[k] = cfg[k];
  }
  for (const [group, fields] of Object.entries(AUDIO_LIVE_FIELDS)) {
    const src = cfg ? cfg[group] : null;
    if (!src || typeof src !== 'object') continue;
    out[group] = {};
    for (const f of fields) {
      if (src[f] !== undefined) out[group][f] = src[f];
    }
  }
  const dirtyGroups = opts.derivedSignalsGroups ? [...opts.derivedSignalsGroups] : [];
  if (dirtyGroups.length > 0 && cfg?.derivedSignals && typeof cfg.derivedSignals === 'object') {
    const derivedOut = {};
    for (const group of dirtyGroups) {
      const fields = DERIVED_SIGNALS_LIVE_FIELDS[group];
      if (!fields) throw new TypeError(`pickLiveFields: unknown derivedSignals group "${group}"`);
      const src = cfg.derivedSignals[group];
      if (!src || typeof src !== 'object') continue;
      const groupOut = {};
      for (const f of fields) {
        if (src[f] !== undefined) groupOut[f] = src[f];
      }
      derivedOut[group] = groupOut;
    }
    if (Object.keys(derivedOut).length > 0) out.derivedSignals = derivedOut;
  }
  // Persist the operator's mic selection (capture.*) into the scene
  // state. AUDIO_LIVE_CAPTURE_FIELDS only — runtime knobs like
  // sampleRate / channels / ffmpegPath stay sourced from config.yaml.
  if (cfg?.capture && typeof cfg.capture === 'object') {
    const captureOut = {};
    for (const f of AUDIO_LIVE_CAPTURE_FIELDS) {
      if (cfg.capture[f] !== undefined) captureOut[f] = cfg.capture[f];
    }
    if (Object.keys(captureOut).length > 0) out.capture = captureOut;
  }
  return out;
}

/**
 * Reject any PATCH payload that touches a config-only field. Returns
 * `{ ok: true, live }` on success or `{ ok: false, error }` on bad
 * keys. The api_server uses this to issue 400s with a useful message.
 */
export function validateLivePatch(partial) {
  if (!partial || typeof partial !== 'object') {
    return { ok: false, error: 'patch body must be an object' };
  }
  const live = {};
  // Whether this patch touches the capture stream — used by the engine
  // to decide between a hot reconfigure and a stop/restart.
  let requiresCaptureRestart = false;

  for (const [key, value] of Object.entries(partial)) {
    // Top-level scalar: `enabled` toggle from the iPad.
    if (AUDIO_LIVE_TOPLEVEL_FIELDS.includes(key)) {
      if (key === 'enabled') {
        if (typeof value !== 'boolean') {
          return { ok: false, error: `"enabled" must be a boolean` };
        }
        live.enabled = value;
        requiresCaptureRestart = true;
      }
      continue;
    }

    if (key === 'derivedSignals') {
      try {
        live.derivedSignals = validateDerivedSignalsPatch(value);
      } catch (error) {
        return { ok: false, error: error.message };
      }
      continue;
    }

    // Nested groups: bands, kick, capture.
    if (key === 'capture') {
      if (!value || typeof value !== 'object') {
        return { ok: false, error: `"capture" must be an object of {field: value}` };
      }
      live.capture = {};
      for (const [k, v] of Object.entries(value)) {
        if (!AUDIO_LIVE_CAPTURE_FIELDS.includes(k)) {
          return { ok: false, error: `field "capture.${k}" is not live-tunable; restart the engine to change it` };
        }
        // All capture fields are strings (or null for device when
        // intentionally unset). Reject other types defensively.
        if (v !== null && typeof v !== 'string') {
          return { ok: false, error: `"capture.${k}" must be a string or null` };
        }
        live.capture[k] = v;
      }
      requiresCaptureRestart = true;
      continue;
    }

    const allowedFields = AUDIO_LIVE_FIELDS[key];
    if (!allowedFields) {
      return { ok: false, error: `field "${key}" is not live-tunable; restart the engine to change it` };
    }
    if (!value || typeof value !== 'object') {
      return { ok: false, error: `"${key}" must be an object of {field: value}` };
    }
    const groupValidators = LIVE_FIELD_VALIDATORS[key] || null;
    live[key] = {};
    for (const [k, v] of Object.entries(value)) {
      if (!allowedFields.includes(k)) {
        return { ok: false, error: `field "${key}.${k}" is not live-tunable` };
      }
      // Boolean group fields (e.g. structureDetector.enabled /
      // dropLevelAssist) — the numeric guard below doesn't apply. The
      // allowed boolean fields per group are declared in LIVE_BOOLEAN_FIELDS;
      // everything else is a finite number. (Codex P0: no silent coercion.)
      const boolFields = LIVE_BOOLEAN_FIELDS[key] || [];
      if (boolFields.includes(k)) {
        if (typeof v !== 'boolean') {
          return { ok: false, error: `"${key}.${k}" must be a boolean` };
        }
        live[key][k] = v;
        continue;
      }
      // String-enum group fields (e.g. structureDetector.dropEdgeMode).
      const enumValues = LIVE_STRING_ENUMS[key] && LIVE_STRING_ENUMS[key][k];
      if (enumValues) {
        if (typeof v !== 'string' || !enumValues.includes(v)) {
          return { ok: false, error: `"${key}.${k}" must be one of: ${enumValues.join(', ')}` };
        }
        live[key][k] = v;
        continue;
      }
      if (typeof v !== 'number' || !Number.isFinite(v)) {
        return { ok: false, error: `"${key}.${k}" must be a finite number` };
      }
      // Per-field range/integer guard for groups that have one. Returns
      // 400 with a precise reason — operator can fix the slider and
      // retry without guessing what range is legal. (codex P0: never
      // silently swap an out-of-range value for the default.)
      if (groupValidators && groupValidators[k]) {
        const err = groupValidators[k](v);
        if (err) return { ok: false, error: `"${key}.${k}" ${err}` };
      }
      live[key][k] = v;
    }
  }
  return { ok: true, live, requiresCaptureRestart };
}
