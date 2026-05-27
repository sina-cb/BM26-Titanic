#!/usr/bin/env node
/**
 * tools/list_audio_devices — convenience wrapper around audio_devices.js
 * that prints available microphones to stdout and exits. Same surface
 * as `node engine.js --list_mics`, but without booting the engine.
 *
 * Usage:
 *   node marsin_engine/tools/list_audio_devices.js
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { printMicList } from '../lib/audio_mic_chooser.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const engineDir  = path.resolve(__dirname, '..');

(async () => {
  try {
    await printMicList({ engineDir });
  } catch {
    process.exit(1);
  }
})();
