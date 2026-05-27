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

// `bands` lost `smoothingAlpha` (2026-05-25) in favour of asymmetric
// `attackMs`/`releaseMs` + a `noiseGate` floor. See audio_analyzer.js
// header for the engineering rationale. Per codex P0 "no fallback
// behaviors", the analyzer rejects a `bands` payload that's missing
// any of these — config.yaml supplies them at boot.
export const AUDIO_LIVE_FIELDS = Object.freeze({
  bands: ['lowMaxHz', 'midMaxHz', 'attackMs', 'releaseMs', 'noiseGate'],
  kick:  ['minHz', 'maxHz', 'threshold', 'refractoryMs', 'decayMs'],
  // kickEma — internal kick-detector EMA tuning. Exposed (2026-05-26)
  // so operators can field-tune the asymmetric attack/release and
  // ceiling clamp from CaptainPad without an engine rebuild. The
  // analyzer's constructor seeds these from the merged config; PATCH
  // /audio/config {kickEma:{…}} hot-reconfigures via reconfigure().
  // See audio_analyzer.js constructor comment for the per-field
  // engineering rationale.
  kickEma: ['alphaUp', 'alphaDown', 'trailAlpha', 'ceilingRatio', 'warmupHops'],
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
  kickEma: Object.freeze({
    // Three alpha coefficients share the (0, 1] contract — they're
    // one-pole IIR mixing weights so values <= 0 or > 1 are nonsense.
    alphaUp:      (v) => (v > 0 && v <= 1) ? null : `must be in (0, 1]; got ${v}`,
    alphaDown:    (v) => (v > 0 && v <= 1) ? null : `must be in (0, 1]; got ${v}`,
    trailAlpha:   (v) => (v > 0 && v <= 1) ? null : `must be in (0, 1]; got ${v}`,
    // ceilingRatio: must be > 1.0 — anything <= 1 makes the clamp a
    // FLOOR instead of a ceiling and the EMA would be pinned BELOW
    // the trailing reference, never above. Operator-explicit guard.
    ceilingRatio: (v) => (v > 1.0 && v <= 10.0) ? null : `must be in (1.0, 10.0]; got ${v}`,
    // warmupHops: number of analysis frames used to seed the EMA's
    // initial value before the detector goes live. Integer ≥ 1.
    warmupHops:   (v) => (Number.isInteger(v) && v >= 1 && v <= 1000)
                         ? null : `must be an integer in [1, 1000]; got ${v}`,
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
 * Read the optional audio_config.yaml overrides. Returns {} on
 * missing / malformed file (operator can always re-set from the UI).
 */
export function loadAudioConfig(engineDir) {
  const p = path.join(engineDir, AUDIO_OVERRIDE_FILE);
  if (!fs.existsSync(p)) return {};
  try {
    const obj = yaml.load(fs.readFileSync(p, 'utf8'));
    return (obj && typeof obj === 'object') ? obj : {};
  } catch (err) {
    console.warn(`[audio_config] failed to parse ${AUDIO_OVERRIDE_FILE}: ${err.message}; ignoring`);
    return {};
  }
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
      if (v && typeof v === 'object' && !Array.isArray(v)) {
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
 */
export function pickLiveFields(cfg) {
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
