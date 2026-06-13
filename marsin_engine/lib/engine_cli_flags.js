/**
 * engine_cli_flags — tiny argv parser for engine startup flags that
 * relate to audio capture lifecycle (mic discovery / selection).
 *
 * Intentionally minimal — no dependencies, no positional args, no
 * grouped short flags. The existing pattern-name / model-name parsing
 * lives elsewhere; this file is just the audio CLI surface.
 *
 * Supported flags (see docs/25 §3.4 "Mic discovery"):
 *
 *   --list_mics                  Print detected mics and exit.
 *   --choose_mic                 Interactive chooser. Saves and exits.
 *   --choose_mic --start         Choose/save, then continue normal boot.
 *   --mic "<device>"             Non-interactive override. Saves and continues.
 *   --clear_mic                  Wipe saved mic and exit.
 *   --audio_file "<path>"        Stream a local audio FILE through the same
 *                                capture→analyzer→CPC path as a mic. Forces
 *                                audio.enabled and continues normal boot.
 *
 * Exit-style precedence when multiple are passed (most operators only
 * use one at a time, but the rule keeps surprises off the playa):
 *   --list_mics  >  --clear_mic  >  --choose_mic
 */

export function parseEngineFlags(argv) {
  const flags = {
    listMics: false,
    chooseMic: false,
    start: false,
    mic: null,
    clearMic: false,
    audioFile: null,
  };
  if (!Array.isArray(argv)) return flags;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case '--list_mics':   flags.listMics = true; break;
      case '--choose_mic':  flags.chooseMic = true; break;
      case '--start':       flags.start = true; break;
      case '--clear_mic':   flags.clearMic = true; break;
      case '--mic': {
        const next = argv[i + 1];
        if (!next || next.startsWith('--')) {
          const err = new Error('--mic requires a device string, e.g. --mic "audio=Microphone Array"');
          err.code = 'cli_missing_value';
          throw err;
        }
        flags.mic = next;
        i++;
        break;
      }
      case '--audio_file': {
        const next = argv[i + 1];
        if (!next || next.startsWith('--')) {
          const err = new Error('--audio_file requires a path, e.g. --audio_file /clips/track.wav');
          err.code = 'cli_missing_value';
          throw err;
        }
        flags.audioFile = next;
        i++;
        break;
      }
      default:
        // ignore unknown flags here — outer parseArgs() handles the rest
        break;
    }
  }
  return flags;
}

/**
 * Returns true if any of the audio CLI flags require us to short-circuit
 * normal engine boot. Lets engine.js do:
 *
 *   if (flagsRequireExit(flags)) { handleAudioCli(flags); return; }
 */
export function flagsRequireExit(flags) {
  if (!flags) return false;
  if (flags.listMics)  return true;
  if (flags.clearMic)  return true;
  if (flags.chooseMic && !flags.start) return true;
  return false;
}
