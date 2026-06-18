/**
 * wav_io.mjs — a tiny, dependency-free 16-bit PCM mono WAV codec.
 *
 * Part of the audio-analysis integration harness
 * (marsin_engine/tests/integration). The harness needs to round-trip
 * synthetic audio through a real WAV file so the analyzer sees exactly
 * the same Int16 PCM the production file-replay path (lib/audio_capture
 * file: source) would hand it — no ffmpeg, no native deps, pure JS.
 *
 * Scope (deliberately minimal — this is a TEST fixture, not a general
 * WAV library):
 *   - mono only
 *   - 16-bit signed little-endian PCM (audioFormat = 1)
 *   - canonical 44-byte RIFF/WAVE header + a single `data` chunk
 *
 * Codex P0 (no fallback behaviors): readWavMono throws loudly on any
 * file that isn't exactly this shape rather than guessing. A test
 * fixture that drifts from the contract must fail, not silently decode
 * garbage.
 *
 * WAV/RIFF reference: Microsoft "Multimedia Programming Interface and
 * Data Specifications 1.0" (the canonical RIFF WAVE layout every audio
 * tool implements).
 */

import fs from 'node:fs';

const HEADER_BYTES = 44;
const BITS_PER_SAMPLE = 16;
const NUM_CHANNELS = 1;
const PCM_FORMAT = 1; // linear PCM

/**
 * Encode an Int16Array of mono samples into a Buffer holding a complete
 * 16-bit PCM WAV file (header + data).
 *
 * @param {Int16Array} samples — mono PCM samples in [-32768, 32767]
 * @param {number} sampleRate — e.g. 44100
 * @returns {Buffer}
 */
export function encodeWavMono(samples, sampleRate) {
  if (!(samples instanceof Int16Array)) {
    throw new TypeError('encodeWavMono: samples must be an Int16Array');
  }
  if (!Number.isInteger(sampleRate) || sampleRate <= 0) {
    throw new RangeError(`encodeWavMono: sampleRate must be a positive integer (got ${sampleRate})`);
  }
  const dataBytes = samples.length * (BITS_PER_SAMPLE / 8);
  const byteRate = sampleRate * NUM_CHANNELS * (BITS_PER_SAMPLE / 8);
  const blockAlign = NUM_CHANNELS * (BITS_PER_SAMPLE / 8);
  const buf = Buffer.alloc(HEADER_BYTES + dataBytes);

  // ── RIFF chunk descriptor ────────────────────────────────────────
  buf.write('RIFF', 0, 'ascii');
  buf.writeUInt32LE(36 + dataBytes, 4);   // ChunkSize = 36 + Subchunk2Size
  buf.write('WAVE', 8, 'ascii');

  // ── "fmt " sub-chunk ─────────────────────────────────────────────
  buf.write('fmt ', 12, 'ascii');
  buf.writeUInt32LE(16, 16);              // Subchunk1Size = 16 for PCM
  buf.writeUInt16LE(PCM_FORMAT, 20);      // AudioFormat = 1 (PCM)
  buf.writeUInt16LE(NUM_CHANNELS, 22);    // NumChannels = 1
  buf.writeUInt32LE(sampleRate, 24);      // SampleRate
  buf.writeUInt32LE(byteRate, 28);        // ByteRate
  buf.writeUInt16LE(blockAlign, 32);      // BlockAlign
  buf.writeUInt16LE(BITS_PER_SAMPLE, 34); // BitsPerSample

  // ── "data" sub-chunk ─────────────────────────────────────────────
  buf.write('data', 36, 'ascii');
  buf.writeUInt32LE(dataBytes, 40);       // Subchunk2Size

  // PCM payload (little-endian Int16).
  for (let i = 0; i < samples.length; i++) {
    buf.writeInt16LE(samples[i], HEADER_BYTES + i * 2);
  }
  return buf;
}

/** Encode + write a mono WAV to `filePath`. */
export function writeWavMono(filePath, samples, sampleRate) {
  fs.writeFileSync(filePath, encodeWavMono(samples, sampleRate));
}

/**
 * Decode a 16-bit PCM mono WAV file back into { sampleRate, samples }.
 * Throws (Codex P0) on anything that isn't canonical mono 16-bit PCM —
 * a malformed test fixture must fail loudly, never decode silently.
 *
 * Tolerates extra chunks BEFORE `data` (some encoders insert a LIST/fact
 * chunk) by scanning the chunk list, but rejects non-PCM formats,
 * non-mono channel counts, and non-16-bit depths.
 *
 * @param {string} filePath
 * @returns {{ sampleRate: number, samples: Int16Array }}
 */
export function readWavMono(filePath) {
  const buf = fs.readFileSync(filePath);
  if (buf.length < HEADER_BYTES) {
    throw new Error(`readWavMono: file too short to be a WAV (${buf.length} bytes)`);
  }
  if (buf.toString('ascii', 0, 4) !== 'RIFF') {
    throw new Error('readWavMono: missing RIFF magic');
  }
  if (buf.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('readWavMono: missing WAVE magic');
  }

  // Walk the chunk list starting at byte 12.
  let pos = 12;
  let fmt = null;
  let dataOffset = -1;
  let dataLen = 0;
  while (pos + 8 <= buf.length) {
    const id = buf.toString('ascii', pos, pos + 4);
    const size = buf.readUInt32LE(pos + 4);
    const body = pos + 8;
    if (id === 'fmt ') {
      if (size < 16) throw new Error(`readWavMono: fmt chunk too small (${size})`);
      fmt = {
        audioFormat: buf.readUInt16LE(body + 0),
        numChannels: buf.readUInt16LE(body + 2),
        sampleRate:  buf.readUInt32LE(body + 4),
        bitsPerSample: buf.readUInt16LE(body + 14),
      };
    } else if (id === 'data') {
      dataOffset = body;
      dataLen = size;
      break; // data is the payload; stop here.
    }
    // Chunks are word-aligned: an odd size is padded with one byte.
    pos = body + size + (size & 1);
  }

  if (!fmt) throw new Error('readWavMono: no fmt chunk found');
  if (fmt.audioFormat !== PCM_FORMAT) {
    throw new Error(`readWavMono: not linear PCM (audioFormat=${fmt.audioFormat})`);
  }
  if (fmt.numChannels !== NUM_CHANNELS) {
    throw new Error(`readWavMono: expected mono, got ${fmt.numChannels} channels`);
  }
  if (fmt.bitsPerSample !== BITS_PER_SAMPLE) {
    throw new Error(`readWavMono: expected 16-bit, got ${fmt.bitsPerSample}-bit`);
  }
  if (dataOffset < 0) throw new Error('readWavMono: no data chunk found');
  if (dataOffset + dataLen > buf.length) {
    throw new Error(`readWavMono: data chunk overruns file (offset=${dataOffset} len=${dataLen} fileLen=${buf.length})`);
  }

  const sampleCount = dataLen >> 1; // 2 bytes per sample
  const samples = new Int16Array(sampleCount);
  for (let i = 0; i < sampleCount; i++) {
    samples[i] = buf.readInt16LE(dataOffset + i * 2);
  }
  return { sampleRate: fmt.sampleRate, samples };
}
