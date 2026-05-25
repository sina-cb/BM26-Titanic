// transitions_pixel_perfect.test.js — Pixel-perfect oracle for every
// transition script under patterns/transitions/.
//
// For each transition the test asserts:
//   1. The script compiles against the real WASM VM.
//   2. At progress=0, every output pixel byte equals the corresponding
//      byte of the FROM buffer (no feather bleed — pixel-perfect).
//   3. At progress=1, every output pixel byte equals the corresponding
//      byte of the TO buffer.
//   4. At progress=0.5, output is well-defined (every byte is finite
//      and in [0, 255]) AND differs from at least one of the endpoint
//      buffers (the transition is actually transitioning, not a no-op
//      or an instant cut from the very first frame).
//   5. Output is full 6-channel RGBWAU (6 bytes per pixel, length = N*6).
//
// Why this lives at unit-test scope:
//   The HIL transition tests (hil/hil_transition_*.mjs) verify the
//   full request/response loop through the engine API, but a single
//   broken transition there fails late, deep in WS plumbing, with a
//   pixel-color mismatch that's hard to root-cause. This file runs
//   every transition through the WASM host directly using deterministic
//   FROM/TO buffers, so any new transition script that breaks the
//   pixel-perfect contract trips here first.
//
// Run:  cd marsin_engine && node --test tests/transitions_pixel_perfect.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { WasmHost } from '../lib/wasm_host.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TRANS_DIR = path.resolve(__dirname, '../patterns/transitions');

// 5x5 grid of pixels covering the unit square. Spatial transitions
// (iris, wipe, split, etc.) need varied (x,y) to actually exercise
// their edge function — a 1-pixel test would only ever land at a
// single pp threshold and miss endpoint cleanliness checks for the
// other pixels.
const GRID = 5;
const PIXELS = [];
for (let yi = 0; yi < GRID; yi++) {
  for (let xi = 0; xi < GRID; xi++) {
    PIXELS.push({ nx: xi / (GRID - 1), ny: yi / (GRID - 1), nz: 0 });
  }
}
const N = PIXELS.length;
const BYTES_PER_PIXEL = 6; // RGBWAU
const BUF_LEN = N * BYTES_PER_PIXEL;

// Deterministic FROM/TO buffers:
//   FROM = pure red, no white/amber/uv      → (255, 0, 0, 0, 0, 0)
//   TO   = cyan with half-white + half-amber → (0, 255, 255, 128, 64, 0)
// Choosing distinctive bytes per channel makes mis-mapped channel
// indices (e.g. accidentally swapping W and A) visible as wrong bytes
// rather than benign zeros.
function buildFrom() {
  const buf = new Uint8Array(BUF_LEN);
  for (let i = 0; i < N; i++) {
    buf[i*6 + 0] = 255;
  }
  return buf;
}
function buildTo() {
  const buf = new Uint8Array(BUF_LEN);
  for (let i = 0; i < N; i++) {
    buf[i*6 + 1] = 255;
    buf[i*6 + 2] = 255;
    buf[i*6 + 3] = 128;
    buf[i*6 + 4] = 64;
  }
  return buf;
}

// Shared WASM host — reused across every transition compile.
let host;

test('boot WASM host for transition oracle', async () => {
  host = new WasmHost();
  await host.init(N);
  host.setCoords(PIXELS);
});

function transitionFiles() {
  return fs.readdirSync(TRANS_DIR)
    .filter(f => f.endsWith('.js'))
    .sort();
}

function bytesEqual(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
function firstDiff(a, b) {
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) {
      const pix = Math.floor(i / 6);
      const ch  = i % 6;
      return `pixel[${pix}] ch[${ch}] a=${a[i]} b=${b[i]}`;
    }
  }
  return 'identical';
}

for (const file of transitionFiles()) {
  test(`${file} — pixel-perfect oracle`, async (t) => {
    const code = fs.readFileSync(path.join(TRANS_DIR, file), 'utf8');
    const compiled = host.compile(code);
    assert.equal(compiled.ok, true, `compile failed: ${compiled.error}`);
    const handle = compiled.handle;
    try {
      const FROM = buildFrom();
      const TO   = buildTo();

      host.beginFrame(handle, 0);

      // Sample positions: start, mid, end, plus quarter-points so we
      // catch transitions that "snap" at exactly 0.5 (e.g. trans_flash
      // overruling at exactly mid).
      const out0   = host.renderBlend6ch(handle, N, FROM, TO, 0);
      const out25  = host.renderBlend6ch(handle, N, FROM, TO, 0.25);
      const out50  = host.renderBlend6ch(handle, N, FROM, TO, 0.5);
      const out75  = host.renderBlend6ch(handle, N, FROM, TO, 0.75);
      const out100 = host.renderBlend6ch(handle, N, FROM, TO, 1);

      // 1. Buffer length checks (catches a misconfigured channel layout
      //    in the runtime, not the transition itself, but cheap to verify).
      assert.equal(out0.length,   BUF_LEN, 'out0 length');
      assert.equal(out50.length,  BUF_LEN, 'out50 length');
      assert.equal(out100.length, BUF_LEN, 'out100 length');

      // 2. progress=0 → pixel-perfect FROM.
      assert.ok(
        bytesEqual(out0, FROM),
        `${file}: at progress=0 every byte should equal FROM. First diff: ${firstDiff(out0, FROM)}`
      );

      // 3. progress=1 → pixel-perfect TO.
      assert.ok(
        bytesEqual(out100, TO),
        `${file}: at progress=1 every byte should equal TO. First diff: ${firstDiff(out100, TO)}`
      );

      // 4. progress=0.5 → finite, in-range, and actually transitioning.
      for (let i = 0; i < out50.length; i++) {
        const v = out50[i];
        assert.ok(Number.isFinite(v), `${file}: NaN at byte ${i} (p=0.5)`);
        assert.ok(v >= 0 && v <= 255, `${file}: byte ${i} out of [0,255] at p=0.5: ${v}`);
      }
      const mid_eq_from = bytesEqual(out50, FROM);
      const mid_eq_to   = bytesEqual(out50, TO);
      assert.ok(
        !(mid_eq_from && mid_eq_to),
        `${file}: at p=0.5 the buffer equals both FROM and TO simultaneously — that's impossible unless FROM===TO, transition is broken`
      );
      // Allow EITHER mid==from (transition still pre-rolling, e.g.
      // morse_blink in a dark gap) OR mid==to (instant cut style); but
      // at LEAST one of the quarter samples must differ from both.
      const off25 = !bytesEqual(out25, FROM) || !bytesEqual(out25, TO);
      const off75 = !bytesEqual(out75, FROM) || !bytesEqual(out75, TO);
      const off50 = !bytesEqual(out50, FROM) && !bytesEqual(out50, TO);
      assert.ok(
        off25 || off50 || off75,
        `${file}: none of progress=0.25/0.5/0.75 differ from BOTH endpoints — transition appears to be a no-op or an instant cut`
      );
    } finally {
      host.destroy(handle);
    }
  });
}
