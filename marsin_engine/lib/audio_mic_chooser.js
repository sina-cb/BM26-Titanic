/**
 * audio_mic_chooser — interactive mic selection prompt + tying
 * together discovery (audio_devices) and persistence
 * (audio_config_store).
 *
 * Used by the engine's --choose_mic flag and by tools/list_audio_devices.js.
 *
 * All TTY-aware behaviour lives here; the discovery + persistence
 * modules stay headless and easily testable.
 */

import readline from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import {
  listAudioDevices, deviceToCaptureConfig, defaultInputFormatFor,
} from './audio_devices.js';
import {
  loadSceneAudio, saveSelectedMic, clearSavedMic,
} from './audio_config_store.js';

/** Pretty-print a list to the operator. */
export function formatDeviceList(devices, { numbered = true } = {}) {
  if (!devices.length) return '  (no microphones detected)';
  return devices
    .map((d, i) => {
      const prefix = numbered ? `  [${i + 1}]` : '  -';
      // 30-char label column for clean alignment.
      const label = d.label.length > 30 ? d.label.slice(0, 27) + '...' : d.label.padEnd(30);
      return `${prefix} ${label} ${d.inputFormat} ${d.ffmpegDevice}${d.isDefault ? '  (default)' : ''}`;
    })
    .join('\n');
}

/**
 * Print available mics and exit. Used by both `--list_mics` and the
 * `tools/list_audio_devices.js` helper.
 */
export async function printMicList({ sceneDir, ffmpegPath = 'ffmpeg', platform = process.platform } = {}) {
  try {
    const { devices, inputFormat } = await listAudioDevices({ ffmpegPath, platform });
    stdout.write(`Detected microphones (${platform} / ${inputFormat}):\n\n`);
    stdout.write(formatDeviceList(devices) + '\n');
    if (sceneDir) {
      const saved = loadSceneAudio(sceneDir);
      if (saved?.capture?.device) {
        stdout.write(`\nCurrent saved mic for this scene: ${saved.capture.deviceLabel || saved.capture.device} (${saved.capture.inputFormat || '?'})\n`);
      }
    }
  } catch (err) {
    stdout.write(`Failed to list devices: ${err.message}\n`);
    if (err.code === 'ffmpeg_missing') {
      stdout.write('Install ffmpeg or set audio.capture.ffmpegPath in config.yaml.\n');
    }
    throw err;
  }
}

/**
 * Interactive chooser. Returns the chosen AudioDevice, or null if the
 * user aborted (q / EOF). Caller is responsible for saving via
 * `saveSelectedMic(engineDir, deviceToCaptureConfig(device))`.
 */
export async function chooseMicInteractively({
  sceneDir,
  ffmpegPath = 'ffmpeg',
  platform = process.platform,
} = {}) {
  if (!stdin.isTTY) {
    const err = new Error(
      '--choose_mic requires an interactive terminal. Use --mic "<device>" for non-interactive setup, ' +
      'or --list_mics to inspect available devices.',
    );
    err.code = 'cli_not_interactive';
    throw err;
  }

  const rl = readline.createInterface({ input: stdin, output: stdout });
  try {
    // If there's a saved mic, show it first and ask to keep.
    const saved = sceneDir ? loadSceneAudio(sceneDir) : {};
    if (saved?.capture?.device) {
      stdout.write('\nCurrent saved microphone:\n\n');
      stdout.write(`  ${saved.capture.deviceLabel || '(unlabelled)'}\n`);
      stdout.write(`  ffmpeg device: ${saved.capture.device}\n`);
      stdout.write(`  input format:  ${saved.capture.inputFormat || '?'}\n`);
      if (saved.capture.selectedAt) stdout.write(`  selected:      ${saved.capture.selectedAt}\n`);
      stdout.write('\n');
      const keep = (await rl.question('Keep this microphone? [Y/n] ')).trim().toLowerCase();
      if (keep === '' || keep === 'y' || keep === 'yes') {
        stdout.write('Keeping saved microphone.\n');
        return null;
      }
    }

    // Scan + chooser loop.
    // eslint-disable-next-line no-constant-condition
    while (true) {
      stdout.write('\nScanning audio devices...\n');
      let devices = [];
      try {
        const r = await listAudioDevices({ ffmpegPath, platform });
        devices = r.devices;
      } catch (err) {
        stdout.write(`Failed to scan: ${err.message}\n`);
        if (err.code === 'ffmpeg_missing') {
          stdout.write('Install ffmpeg or set audio.capture.ffmpegPath in config.yaml.\n');
          return null;
        }
      }

      if (devices.length === 0) {
        stdout.write('No microphones detected.\n');
        const retry = (await rl.question('Retry scan? [y/N] ')).trim().toLowerCase();
        if (retry === 'y' || retry === 'yes') continue;
        return null;
      }

      stdout.write('\nDetected microphones:\n\n');
      stdout.write(formatDeviceList(devices) + '\n\n');
      const ans = (await rl.question(`Choose microphone [1-${devices.length}], r to refresh, q to quit: `)).trim().toLowerCase();
      if (ans === 'q' || ans === '') return null;
      if (ans === 'r') continue;
      const n = parseInt(ans, 10);
      if (!Number.isInteger(n) || n < 1 || n > devices.length) {
        stdout.write(`Invalid selection: ${ans}\n`);
        continue;
      }
      return devices[n - 1];
    }
  } finally {
    rl.close();
  }
}

/**
 * Top-level handler dispatched by engine.js when an audio CLI flag is
 * present. Composes discovery + chooser + persistence.
 *
 * Returns `{ shouldExit, exitCode, message? }` so engine.js can decide
 * whether to continue booting or terminate.
 */
/**
 * Dispatched by engine.js when an audio CLI flag is present.
 *
 * Flags that mutate state (--choose_mic, --mic, --clear_mic) require a
 * `sceneDir` because mic selection now lives inside the scene's
 * audio_state.yaml. The engine resolves the dir from --model. If the
 * operator forgot --model, we bail with a clear message instead of
 * writing the mic into a mystery directory.
 *
 * --list_mics is purely read-only and works without --model. If a
 * sceneDir IS passed (operator ran with --model anyway) we surface the
 * scene's currently-saved mic alongside the live device list.
 */
export async function handleAudioCliFlags(flags, { sceneDir = null, ffmpegPath = 'ffmpeg', platform = process.platform } = {}) {
  if (!flags) return { shouldExit: false };

  if (flags.listMics) {
    try { await printMicList({ sceneDir, ffmpegPath, platform }); return { shouldExit: true, exitCode: 0 }; }
    catch { return { shouldExit: true, exitCode: 1 }; }
  }

  // The remaining flags all mutate the scene's audio_state.yaml.
  const requireScene = (flag) => {
    if (!sceneDir) {
      stdout.write(
        `${flag} writes to the per-scene audio_state.yaml. Add --model <scene> ` +
        `to tell the engine which scene to update, e.g.\n\n` +
        `  node marsin_engine/engine.js ${flag} --model test_bench\n`,
      );
      return false;
    }
    return true;
  };

  if (flags.clearMic) {
    if (!requireScene('--clear_mic')) return { shouldExit: true, exitCode: 1 };
    const r = clearSavedMic(sceneDir);
    stdout.write(r.cleared
      ? `Cleared saved microphone from ${sceneDir}/audio_state.yaml\n`
      : 'No saved microphone to clear.\n');
    return { shouldExit: true, exitCode: 0 };
  }

  if (flags.mic) {
    if (!requireScene('--mic')) return { shouldExit: true, exitCode: 1 };
    const fmt = defaultInputFormatFor(platform);
    saveSelectedMic(sceneDir, {
      platform, inputFormat: fmt, device: flags.mic,
      deviceId: null, deviceLabel: flags.mic, selectedAt: new Date().toISOString(),
    });
    stdout.write(`Saved manual microphone: ${flags.mic} (${platform} / ${fmt})\n`);
    return { shouldExit: false };
  }

  if (flags.chooseMic) {
    if (!requireScene('--choose_mic')) return { shouldExit: true, exitCode: 1 };
    let chosen = null;
    try {
      chosen = await chooseMicInteractively({ sceneDir, ffmpegPath, platform });
    } catch (err) {
      stdout.write(`\n${err.message}\n`);
      return { shouldExit: true, exitCode: 1 };
    }
    if (chosen) {
      const cfg = deviceToCaptureConfig(chosen);
      saveSelectedMic(sceneDir, cfg);
      stdout.write('\nSaved microphone:\n\n');
      stdout.write(`  ${cfg.deviceLabel}\n`);
      stdout.write(`  ffmpeg device: ${cfg.device}\n`);
      stdout.write(`  scene file:    ${sceneDir}/audio_state.yaml\n`);
    }
    if (flags.start) return { shouldExit: false };
    return { shouldExit: true, exitCode: 0 };
  }

  return { shouldExit: false };
}
