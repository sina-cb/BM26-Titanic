/**
 * audio_decode.mjs — decode arbitrary audio (mp3 / flac / wav / MUSDB
 * `.stem.mp4`) into mono 44.1 kHz 16-bit PCM WAV for the integration
 * harness, using the SAME ffmpeg-static binary the production file-replay
 * capture path (lib/audio_capture.js) uses.
 *
 * This is the REAL-CORPUS arm of the harness. It is deliberately NOT
 * imported by the synthetic regression guard
 * (audio_analysis_validation.test.mjs) — that test stays dependency-free
 * and deterministic. Decoding real audio requires the ffmpeg-static binary
 * (already a marsin-engine dependency) and is opt-in via the corpus
 * scripts.
 *
 * Codex P0 — NO FALLBACK BEHAVIORS: a failed decode (nonzero ffmpeg exit,
 * missing binary, malformed output) THROWS. We never substitute silence or
 * a partial buffer for audio that did not decode.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import ffmpegPath from 'ffmpeg-static';

import { readWavMono } from './wav_io.mjs';

const TARGET_SR = 44100;

if (typeof ffmpegPath !== 'string' || !fs.existsSync(ffmpegPath)) {
  throw new Error(`audio_decode: ffmpeg-static binary not found (got ${ffmpegPath}). Run \`npm install\` in marsin_engine.`);
}

/**
 * Decode one audio stream of `inputPath` to a mono 44.1 kHz 16-bit WAV at
 * `outWavPath`. `streamIndex` selects which audio stream (0 = first; for a
 * MUSDB `.stem.mp4`: 0=mixture, 1=drums, 2=bass, 3=other, 4=vocals).
 *
 * @returns {string} outWavPath
 */
export function decodeToMonoWav(inputPath, outWavPath, { streamIndex = 0, sampleRate = TARGET_SR } = {}) {
  if (!fs.existsSync(inputPath)) {
    throw new Error(`decodeToMonoWav: input not found: ${inputPath}`);
  }
  fs.mkdirSync(path.dirname(outWavPath), { recursive: true });
  const args = [
    '-y', '-loglevel', 'error',
    '-i', inputPath,
    '-map', `0:a:${streamIndex}`,
    '-ac', '1',
    '-ar', String(sampleRate),
    '-c:a', 'pcm_s16le',
    '-f', 'wav',
    outWavPath,
  ];
  // execFileSync throws on nonzero exit — exactly the fail-loud behavior we
  // want. stderr is surfaced in the thrown error.
  execFileSync(ffmpegPath, args, { stdio: ['ignore', 'ignore', 'pipe'] });
  if (!fs.existsSync(outWavPath) || fs.statSync(outWavPath).size <= 44) {
    throw new Error(`decodeToMonoWav: ffmpeg produced no audio for ${inputPath} (stream ${streamIndex})`);
  }
  return outWavPath;
}

/**
 * Decode `inputPath` (stream `streamIndex`) straight to { sampleRate,
 * samples } via a temp WAV (removed after read).
 */
export function decodeToSamples(inputPath, { streamIndex = 0, sampleRate = TARGET_SR } = {}) {
  const tmp = path.join(os.tmpdir(), `audiodec_${process.pid}_${Date.now()}_${Math.random().toString(36).slice(2)}.wav`);
  try {
    decodeToMonoWav(inputPath, tmp, { streamIndex, sampleRate });
    return readWavMono(tmp);
  } finally {
    if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
  }
}

/** MUSDB `.stem.mp4` stream order (see sigsep mus.yaml). */
export const MUSDB_STREAMS = { mixture: 0, drums: 1, bass: 2, other: 3, vocals: 4 };

/**
 * Decode a MUSDB `.stem.mp4` into the 5 mono WAVs (mixture + 4 stems) under
 * `outDir/<prefix>_<part>.wav`. Returns { mixture, drums, bass, other,
 * vocals } → wav path.
 */
export function decodeStemMp4(inputPath, outDir, prefix, { sampleRate = TARGET_SR } = {}) {
  const out = {};
  for (const [part, idx] of Object.entries(MUSDB_STREAMS)) {
    const p = path.join(outDir, `${prefix}_${part}.wav`);
    decodeToMonoWav(inputPath, p, { streamIndex: idx, sampleRate });
    out[part] = p;
  }
  return out;
}
