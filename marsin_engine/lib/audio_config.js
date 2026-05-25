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

export const AUDIO_LIVE_FIELDS = Object.freeze({
  bands: ['lowMaxHz', 'midMaxHz', 'smoothingAlpha'],
  kick:  ['minHz', 'maxHz', 'threshold', 'refractoryMs', 'decayMs'],
});

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
  for (const [group, fields] of Object.entries(partial)) {
    const allowedFields = AUDIO_LIVE_FIELDS[group];
    if (!allowedFields) {
      return { ok: false, error: `field "${group}" is not live-tunable; restart the engine to change it` };
    }
    if (!fields || typeof fields !== 'object') {
      return { ok: false, error: `"${group}" must be an object of {field: value}` };
    }
    live[group] = {};
    for (const [k, v] of Object.entries(fields)) {
      if (!allowedFields.includes(k)) {
        return { ok: false, error: `field "${group}.${k}" is not live-tunable` };
      }
      if (typeof v !== 'number' || !Number.isFinite(v)) {
        return { ok: false, error: `"${group}.${k}" must be a finite number` };
      }
      live[group][k] = v;
    }
  }
  return { ok: true, live };
}
