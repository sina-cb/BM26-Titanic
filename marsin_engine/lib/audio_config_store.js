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
  '# Written by `engine.js --choose_mic --model <scene>` (mic) and by\n' +
  '# PATCH /audio/config from CaptainPad (tuning). Do not hand-edit while\n' +
  '# the engine is running.\n';

// Fields that count as "mic selection" — preserved together by
// saveSelectedMic, wiped together by clearSavedMic.
const MIC_FIELDS = ['platform', 'inputFormat', 'device', 'deviceId', 'deviceLabel', 'selectedAt'];

// ── Paths ─────────────────────────────────────────────────────────────────

export function sceneAudioPath(sceneDir) {
  return path.join(sceneDir, SCENE_FILE_NAME);
}

// ── Load / save (whole file) ──────────────────────────────────────────────

/** Read the per-scene audio file. Returns {} on missing / malformed. */
export function loadSceneAudio(sceneDir) {
  const p = sceneAudioPath(sceneDir);
  if (!fs.existsSync(p)) return {};
  try {
    const obj = yaml.load(fs.readFileSync(p, 'utf8'));
    return (obj && typeof obj === 'object') ? obj : {};
  } catch (err) {
    console.warn(`[audio_config_store] failed to parse ${SCENE_FILE_NAME}: ${err.message}; ignoring`);
    return {};
  }
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

function _atomicWrite(targetPath, obj) {
  const tmp = `${targetPath}.tmp`;
  try {
    fs.writeFileSync(tmp, FILE_HEADER + yaml.dump(obj, { sortKeys: false }));
    fs.renameSync(tmp, targetPath);
  } catch (err) {
    console.warn(`[audio_config_store] failed to write ${targetPath}: ${err.message}`);
  }
}
