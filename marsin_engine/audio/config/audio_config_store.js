/**
 * audio_config_store — persistence for everything operator-tunable in
 * the audio listener: mic selection AND band/kick tuning. Both live
 * inside the per-scene state file:
 *
 *   marsin_engine/states/<scene>/audio_state.yaml
 *
 * Why one file instead of an extra per-machine `audio_config.yaml`:
 *   - One source of truth simplifies boot, debugging, and the docs.
 *   - Running the same scene on a different machine just means
 *     re-running `--choose_mic --model <scene>` on that machine
 *     once. The trade-off ("git pull may rewrite my mic") is small
 *     compared to the cognitive load of two files.
 *
 * Operations:
 *   loadSceneAudio(sceneDir)            → full audio_state.yaml as object
 *   saveSceneAudio(sceneDir, partial)   → atomic write of the whole file
 *   saveSelectedMic(sceneDir, capCfg)   → updates ONLY the capture.* slice;
 *                                          preserves bands/kick/enabled/…
 *   saveManualMic(sceneDir, dev, opts)  → like saveSelectedMic but from a
 *                                          raw device string
 *   clearSavedMic(sceneDir)             → strips capture.* without touching
 *                                          tuning; deletes file if nothing
 *                                          else remains
 */

import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';

const SCENE_FILE_NAME = 'audio_state.yaml';

const FILE_HEADER =
  '# Auto-written by MarsinEngine — per-scene audio state.\n' +
  '# Contains:\n' +
  '#   - mic selection  (capture.platform/inputFormat/device/deviceLabel/deviceId/selectedAt)\n' +
  '#   - listener tuning (enabled, fftSize, hopSize, bands{...}, kick{...})\n' +
  '#   - derivedSignals groups the operator has actually live-patched; every\n' +
  '#     group absent here is owned by config.yaml and follows its retunes\n' +
  '# The ENGINE is the SOLE writer: `engine.js --choose_mic --model <scene>` (mic)\n' +
  '# and PATCH /audio/config (tuning — including Audio Companion edits, which the\n' +
  '# Companion writes THROUGH to the engine rather than to this file).\n' +
  '# Do not hand-edit while the engine is running.\n';

// Fields that count as "mic selection" — preserved together by
// saveSelectedMic, wiped together by clearSavedMic.
const MIC_FIELDS = ['platform', 'inputFormat', 'device', 'deviceId', 'deviceLabel', 'selectedAt'];

// ── Paths ─────────────────────────────────────────────────────────────────

export function sceneAudioPath(sceneDir) {
  return path.join(sceneDir, SCENE_FILE_NAME);
}

// ── Load / save (whole file) ──────────────────────────────────────────────

/**
 * Read the per-scene audio file.
 *
 * MISSING file → `{}`: a scene that has never been tuned legitimately has no
 * state, and the caller's config.yaml defaults are the whole truth.
 *
 * PARSE FAILURE → THROWS (codex P0, no fallback). Returning `{}` here was
 * destructive, not graceful: every caller does `load → merge → save`, so one
 * unparseable byte made the engine boot-write its own defaults straight over
 * the operator's saved mic + tuning — the file was destroyed by the very read
 * that "recovered" from it. Fail loudly instead; the operator fixes or deletes
 * the file. The thrown message names the full path so that fix is one step.
 */
export function loadSceneAudio(sceneDir) {
  const p = sceneAudioPath(sceneDir);
  if (!fs.existsSync(p)) return {};
  let raw;
  try {
    raw = fs.readFileSync(p, 'utf8');
  } catch (err) {
    throw new Error(`failed to read ${p}: ${err.message}`);
  }
  let obj;
  try {
    obj = yaml.load(raw);
  } catch (err) {
    throw new Error(
      `failed to parse ${p}: ${err.message} — fix or delete the file; ` +
      'the engine will NOT overwrite a state file it could not read',
    );
  }
  return (obj && typeof obj === 'object') ? obj : {};
}

/**
 * Replace the audio_state.yaml contents with the supplied object.
 * Used by PATCH /audio/config after merging the live-tunable subset.
 * Creates the scene dir if missing.
 */
export function saveSceneAudio(sceneDir, fullObj) {
  if (!sceneDir) throw new Error('saveSceneAudio requires a sceneDir');
  try { fs.mkdirSync(sceneDir, { recursive: true }); } catch { /* exists */ }
  _atomicWrite(sceneAudioPath(sceneDir), fullObj || {});
}

// ── Mic-selection helpers (operate on the same file) ──────────────────────

/**
 * Merge the given capture slice into audio_state.yaml without disturbing
 * any other fields. Used by `--choose_mic`. Only the documented
 * MIC_FIELDS are overwritten on the existing capture block.
 */
export function saveSelectedMic(sceneDir, captureSlice) {
  if (!captureSlice || typeof captureSlice !== 'object') {
    throw new TypeError('saveSelectedMic requires a capture-config object');
  }
  const existing = loadSceneAudio(sceneDir);
  const nextCapture = { ...(existing.capture || {}) };
  for (const k of MIC_FIELDS) {
    if (captureSlice[k] !== undefined) nextCapture[k] = captureSlice[k];
  }
  const next = { ...existing, capture: nextCapture };
  saveSceneAudio(sceneDir, next);
  return next;
}

/**
 * Manual `--mic "<device>"` path: records the raw device string with
 * the current platform + default input format. deviceLabel mirrors the
 * device string for UI display.
 */
export function saveManualMic(sceneDir, deviceString, { platform = process.platform, inputFormat = null } = {}) {
  if (!deviceString || typeof deviceString !== 'string') {
    throw new TypeError('saveManualMic requires a non-empty device string');
  }
  return saveSelectedMic(sceneDir, {
    platform,
    inputFormat,
    device:      deviceString,
    deviceId:    null,
    deviceLabel: deviceString,
    selectedAt:  new Date().toISOString(),
  });
}

/**
 * Remove ONLY the mic-selection fields. If the file ends up with no
 * remaining keys (no tuning, no other capture fields), delete it.
 */
export function clearSavedMic(sceneDir) {
  const p = sceneAudioPath(sceneDir);
  if (!fs.existsSync(p)) return { cleared: false };
  const existing = loadSceneAudio(sceneDir);
  if (!existing.capture) return { cleared: false };
  const cap = { ...existing.capture };
  for (const k of MIC_FIELDS) delete cap[k];
  const next = { ...existing };
  if (Object.keys(cap).length === 0) delete next.capture;
  else next.capture = cap;
  if (Object.keys(next).length === 0) {
    try { fs.unlinkSync(p); } catch { /* ignore */ }
  } else {
    saveSceneAudio(sceneDir, next);
  }
  return { cleared: true };
}

// ── Internal ──────────────────────────────────────────────────────────────

/**
 * Write the state file atomically (temp + rename).
 *
 * THROWS on any failure (codex P0). Swallowing the error with a console.warn
 * made PATCH /audio/config answer 200 on a persist that never happened: the
 * operator saw the knob take, and the next boot silently restored the old
 * value. The temp name carries the writer's PID so two processes writing the
 * same scene can't clobber each other's half-written temp file.
 */
function _atomicWrite(targetPath, obj) {
  const tmp = `${targetPath}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(tmp, FILE_HEADER + yaml.dump(obj, { sortKeys: false }));
    fs.renameSync(tmp, targetPath);
  } catch (err) {
    // Best-effort cleanup so a failed write doesn't leave litter behind; the
    // original error is what the caller must see.
    try { fs.unlinkSync(tmp); } catch { /* nothing to clean up */ }
    throw new Error(`failed to write ${targetPath}: ${err.message}`);
  }
}
