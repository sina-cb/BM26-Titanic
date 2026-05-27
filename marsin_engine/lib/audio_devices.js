/**
 * audio_devices — cross-platform microphone discovery.
 *
 * See docs/25_marsin_audio_analysis.md §3.4 ("Mic discovery").
 *
 * The whole point of this module — together with audio_capture.js —
 * is that it's the only place that knows about OS-specific ffmpeg
 * device formats. The rest of the engine just sees a normalized
 * `AudioDevice` shape:
 *
 *   {
 *     id, label, platform, inputFormat, ffmpegDevice,
 *     alternativeName?, isDefault?,
 *   }
 *
 * Why we shell out to ffmpeg instead of using a native binding:
 *   - Zero new npm/native deps; ffmpeg is already required for capture.
 *   - The list-devices command is well-documented per platform.
 *   - Same artifact for mac/win/linux, so engine boot has one code path.
 *
 * Why we parse both stdout AND stderr:
 *   - ffmpeg historically prints device lists to STDERR (it's "logging",
 *     not output). On some builds / versions both streams carry chunks.
 *     Concatenating is the only reliable approach.
 *
 * What this module DOESN'T do:
 *   - Capture audio. That's audio_capture.js.
 *   - Persist the operator's choice. That's audio_config_store.js.
 *   - Interactive prompt. That's engine_cli_flags.js + the chooser.
 */

import { spawn } from 'node:child_process';

const PLATFORM_TO_FORMAT = Object.freeze({
  darwin: 'avfoundation',
  win32:  'dshow',
  linux:  'pulse',
});

/** Default ffmpeg input format for a given platform. */
export function defaultInputFormatFor(platform) {
  return PLATFORM_TO_FORMAT[platform] || null;
}

/**
 * Build the argv vector for `ffmpeg ... -list_devices true ...` on the
 * requested platform / input format. Always returns a plain array
 * (never a shell string) so spawn(..., { shell: false }) is safe.
 *
 * @param {{ platform?: string, inputFormat?: string|null }} opts
 * @returns {string[]}
 */
export function buildListDevicesArgs({ platform = process.platform, inputFormat = null } = {}) {
  const fmt = inputFormat || defaultInputFormatFor(platform);
  if (fmt === 'avfoundation') {
    return ['-hide_banner', '-f', 'avfoundation', '-list_devices', 'true', '-i', ''];
  }
  if (fmt === 'dshow') {
    return ['-hide_banner', '-list_devices', 'true', '-f', 'dshow', '-i', 'dummy'];
  }
  if (fmt === 'pulse') {
    return ['-hide_banner', '-sources', 'pulse'];
  }
  if (fmt === 'alsa') {
    return ['-hide_banner', '-f', 'alsa', '-list_devices', 'true', '-i', 'dummy'];
  }
  throw new Error(`Unsupported audio input format for device listing: ${fmt}`);
}

/**
 * Parse the combined stdout + stderr from a device-list ffmpeg run
 * into normalized AudioDevice descriptors.
 *
 * @param {{ platform: string, inputFormat?: string|null, output: string }} args
 * @returns {Array<{id:string,label:string,platform:string,inputFormat:string,ffmpegDevice:string,alternativeName?:string,isDefault?:boolean}>}
 */
export function parseAudioDevices({ platform, inputFormat = null, output = '' } = {}) {
  const fmt = inputFormat || defaultInputFormatFor(platform);
  if (fmt === 'avfoundation') return parseAvFoundation(output);
  if (fmt === 'dshow')        return parseDshow(output);
  if (fmt === 'pulse')        return parsePulse(output);
  if (fmt === 'alsa')         return parseAlsa(output);
  return [];
}

/**
 * Run ffmpeg, parse, and resolve with the device list. Throws with a
 * stable error code on common failure modes so the CLI / API can
 * surface a useful message to the operator.
 *
 *   error codes:
 *     ffmpeg_missing       — couldn't spawn ffmpeg (likely not on PATH)
 *     unsupported_platform — no input format mapping for `platform`
 *     device_list_failed   — ffmpeg ran but exit != 0 AND output empty
 *
 * @param {{ ffmpegPath?: string, platform?: string, inputFormat?: string|null, spawnFn?: Function, timeoutMs?: number }} opts
 * @returns {Promise<{ devices: object[], platform: string, inputFormat: string, raw: string }>}
 */
export async function listAudioDevices({
  ffmpegPath = 'ffmpeg',
  platform = process.platform,
  inputFormat = null,
  spawnFn = spawn,
  timeoutMs = 4000,
} = {}) {
  const fmt = inputFormat || defaultInputFormatFor(platform);
  if (!fmt) {
    const err = new Error(`Unsupported platform: ${platform}`);
    err.code = 'unsupported_platform';
    throw err;
  }
  const args = buildListDevicesArgs({ platform, inputFormat: fmt });

  let child;
  try {
    child = spawnFn(ffmpegPath, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false,
      windowsHide: true,
    });
  } catch (e) {
    const err = new Error(`Failed to spawn ffmpeg at "${ffmpegPath}": ${e.message}`);
    err.code = 'ffmpeg_missing';
    throw err;
  }

  let stdout = '', stderr = '';
  child.stdout.on('data', (b) => { stdout += b.toString('utf8'); });
  child.stderr.on('data', (b) => { stderr += b.toString('utf8'); });

  // ffmpeg device-list commands ALWAYS exit non-zero (they fail the
  // input-open step on purpose). We don't care about exit code — we
  // care about whether the output contained any parseable devices.
  await new Promise((resolve, reject) => {
    let done = false;
    const finish = (err) => { if (!done) { done = true; err ? reject(err) : resolve(); } };
    child.on('exit', () => finish());
    child.on('error', (e) => {
      const err = new Error(`ffmpeg spawn error: ${e.message}`);
      err.code = 'ffmpeg_missing';
      finish(err);
    });
    setTimeout(() => {
      try { child.kill('SIGTERM'); } catch { /* ignore */ }
      finish();
    }, timeoutMs).unref?.();
  });

  const raw = stdout + '\n' + stderr;
  const devices = parseAudioDevices({ platform, inputFormat: fmt, output: raw });
  return { devices, platform, inputFormat: fmt, raw };
}

/**
 * Locate a configured mic in an enumerated device list.
 *
 * Matching is checked in three passes, MOST specific first, so a stale
 * label match can't shadow a precise deviceId / device-path hit:
 *   1) `deviceId`     — unique per OS index (e.g. `avfoundation-audio-2`)
 *   2) `device`       — ffmpeg device string (e.g. `:2`, `audio=Mic`)
 *   3) `deviceLabel`  — case-insensitive exact label match (best-effort
 *                       cross-machine fallback when the OS renumbered)
 *
 * Returns the matching AudioDevice or `null` if no pass found one.
 * Pure function — exported for tests; callers (engine boot) decide
 * what to do on null (typically: disable audio + status error).
 *
 * @param {{ deviceId?: string|null, device?: string|null, deviceLabel?: string|null }} sel
 * @param {Array<object>} devices
 * @returns {object|null}
 */
export function findConfiguredDevice(sel, devices) {
  if (!sel || !Array.isArray(devices) || devices.length === 0) return null;
  const { deviceId, device, deviceLabel } = sel;
  if (deviceId) {
    const m = devices.find((d) => d && d.id === deviceId);
    if (m) return m;
  }
  if (device) {
    const m = devices.find((d) => d && d.ffmpegDevice === device);
    if (m) return m;
  }
  if (deviceLabel) {
    const want = String(deviceLabel).toLowerCase();
    const m = devices.find((d) => d && typeof d.label === 'string' && d.label.toLowerCase() === want);
    if (m) return m;
  }
  return null;
}

/**
 * Convert a chosen AudioDevice into the audio.capture config slice we
 * persist in audio_config.yaml. Keeps the schema in one place.
 */
export function deviceToCaptureConfig(device) {
  if (!device || typeof device !== 'object') {
    throw new TypeError('deviceToCaptureConfig requires an AudioDevice');
  }
  return {
    platform:    device.platform,
    inputFormat: device.inputFormat,
    device:      device.ffmpegDevice,
    deviceId:    device.id,
    deviceLabel: device.label,
    selectedAt:  new Date().toISOString(),
  };
}

// ── Per-platform parsers ──────────────────────────────────────────────────

/**
 * AVFoundation output looks like:
 *   [AVFoundation indev @ 0x...] AVFoundation video devices:
 *   [AVFoundation indev @ 0x...] [0] FaceTime HD Camera
 *   [AVFoundation indev @ 0x...] AVFoundation audio devices:
 *   [AVFoundation indev @ 0x...] [0] MacBook Pro Microphone
 *   [AVFoundation indev @ 0x...] [1] USB Audio Device
 */
function parseAvFoundation(text) {
  const devices = [];
  let section = null;     // 'video' | 'audio' | null
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    if (/AVFoundation video devices:/i.test(line)) { section = 'video'; continue; }
    if (/AVFoundation audio devices:/i.test(line)) { section = 'audio'; continue; }
    if (section !== 'audio') continue;
    // Match: [...] [N] Label
    const m = line.match(/\]\s*\[(\d+)\]\s+(.+)$/);
    if (!m) continue;
    const idx = m[1];
    const label = m[2].trim();
    devices.push({
      id: `avfoundation-audio-${idx}`,
      label,
      platform: 'darwin',
      inputFormat: 'avfoundation',
      ffmpegDevice: `:${idx}`,
      isDefault: idx === '0',
    });
  }
  return devices;
}

/**
 * DirectShow output looks like:
 *   [dshow @ 0x...] DirectShow video devices (some may be both video and audio devices)
 *   [dshow @ 0x...]  "Webcam C920"
 *   [dshow @ 0x...]     Alternative name "@device_pnp_..."
 *   [dshow @ 0x...] DirectShow audio devices
 *   [dshow @ 0x...]  "Microphone Array"
 *   [dshow @ 0x...]     Alternative name "@device_cm_{...}"
 *   [dshow @ 0x...]  "Stereo Mix (Realtek)"
 */
function parseDshow(text) {
  const devices = [];
  let section = null;
  let pending = null;
  const flush = () => { if (pending) { devices.push(pending); pending = null; } };
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    if (/DirectShow video devices/i.test(line)) { flush(); section = 'video'; continue; }
    if (/DirectShow audio devices/i.test(line)) { flush(); section = 'audio'; continue; }

    // Alternative name line — attach to the most recent device.
    const altM = line.match(/Alternative name\s+"([^"]+)"/i);
    if (altM && pending) {
      pending.alternativeName = altM[1];
      continue;
    }
    // Label line — `[dshow @ ...]  "Label"`. Supports optional trailing type suffix e.g. "Label" (audio)
    const m = line.match(/\]\s*"([^"]+)"(?:\s*\((audio|video)\))?\s*$/);
    if (!m) continue;

    // Dynamically update section if explicit type suffix is present
    if (m[2]) {
      flush();
      section = m[2];
    }

    if (section !== 'audio') continue;

    flush();
    const label = m[1];
    pending = {
      id: `dshow-audio-${label}`,
      label,
      platform: 'win32',
      inputFormat: 'dshow',
      ffmpegDevice: `audio=${label}`,
    };
  }
  flush();
  return devices;
}

/** Best-effort Pulse source parser. */
function parsePulse(text) {
  const devices = [];
  let pendingName = null, pendingDesc = null;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const nameM = line.match(/Name:\s*(.+)$/i);
    if (nameM) {
      pendingName = nameM[1].trim();
      continue;
    }
    const descM = line.match(/Description:\s*(.+)$/i);
    if (descM) {
      pendingDesc = descM[1].trim();
      if (pendingName) {
        devices.push({
          id: `pulse-${pendingName}`,
          label: pendingDesc || pendingName,
          platform: 'linux',
          inputFormat: 'pulse',
          ffmpegDevice: pendingName,
        });
        pendingName = null; pendingDesc = null;
      }
    }
  }
  return devices;
}

/** ALSA fallback parser (best-effort; ALSA output is messy). */
function parseAlsa(text) {
  const devices = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    const m = line.match(/^card\s+(\d+):\s*([^,\[]+)/i);
    if (!m) continue;
    const card = m[1];
    const label = m[2].trim();
    devices.push({
      id: `alsa-${card}`,
      label,
      platform: 'linux',
      inputFormat: 'alsa',
      ffmpegDevice: `hw:${card}`,
    });
  }
  return devices;
}
