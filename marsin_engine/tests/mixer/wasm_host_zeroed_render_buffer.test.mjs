// REGRESSION PIN — a pixel the WASM VM SKIPS must come out BLACK, never heap
// residue.
//
// Report `_361` MAJOR 1: `WasmHost.renderAll6ch` used to `_malloc` a fresh
// output block per channel per frame, hand it to the VM UN-ZEROED, and copy
// the whole thing back into the caller's buffer — overwriting the mixer's own
// `fill(0)`, because `set()` is the last writer. With emscripten's dlmalloc a
// repeatedly-freed same-size allocation returns the PREVIOUS frame's rendered
// pixels for that channel, so any slot the VM did not write emitted another
// frame's / another channel's colour.
//
// That the VM skips pixels is measured, not hypothetical: overrunning the
// per-pixel instruction budget truncates the render silently (red-team `_112`
// F9/F2). A PARTIAL overrun trips no detector either — the never-black
// enforcer only flags a composite that is UNIFORMLY black or uniformly red —
// which is why this ran for weeks as "every now and then I see random
// colours".
//
// The VM is a black box (no C source is vendored), so a truncated render
// cannot be provoked deterministically here. These tests therefore pin the JS
// side of the contract, which is exactly where the fault was: the host must
// hand the VM a zeroed block and must not resurrect bytes the VM leaves
// alone. The `_renderAllWithMeta6ch` / `_renderBlend6ch` bindings are stubbed
// to write a controlled prefix; everything else — the real Module, the real
// heap, the real allocator — is genuine.
//
// Run: cd marsin_engine && node --test tests/mixer/wasm_host_zeroed_render_buffer.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';

import { WasmHost } from '../../lib/wasm_host.js';

const N = 24;
const SIZE = N * 6;
const HANDLE = 1; // any truthy value: the stubbed VM binding ignores it

function mkCoords(n) {
  const out = [];
  for (let i = 0; i < n; i++) out.push({ nx: i / (n - 1), ny: (i % 7) / 6, nz: (i % 5) / 4 });
  return out;
}

async function mkHost() {
  const host = new WasmHost();
  await host.init(N);
  host.setCoords(mkCoords(N));
  return host;
}

/**
 * Replace the VM binding with one that writes `byte` into the first
 * `writtenBytes` of the output block and touches nothing else — a render that
 * truncated partway through, which is the `_112` F9 failure shape.
 */
function stubTruncatingVm(host, state) {
  host._renderAllWithMeta6ch = (_handle, ptr) => {
    host.Module.HEAPU8.fill(state.byte, ptr, ptr + state.writtenBytes);
  };
}

test('a truncated render leaves the skipped tail BLACK, not last frame\'s pixels', async () => {
  const host = await mkHost();
  const state = { byte: 0xAB, writtenBytes: SIZE };
  stubTruncatingVm(host, state);
  const out = new Uint8Array(SIZE);

  // Frame 1 — the VM writes everything. This is what poisons the reused
  // block: 0xAB is now sitting in the exact bytes frame 2 will be handed.
  host.renderAll6ch(HANDLE, out);
  assert.ok(out.every(b => b === 0xAB), 'frame 1 must render fully (sets up the residue)');

  // Frame 2 — the VM truncates halfway.
  const half = SIZE / 2;
  state.byte = 0x7F;
  state.writtenBytes = half;
  host.renderAll6ch(HANDLE, out);

  assert.ok(out.subarray(0, half).every(b => b === 0x7F),
    'pixels the VM DID write must be untouched by the zeroing');
  const tail = out.subarray(half);
  assert.ok(tail.every(b => b === 0),
    `skipped pixels must be black, got residue: [${Array.from(tail.subarray(0, 12)).join(',')}]`);
});

test('a render that writes NOTHING yields a fully black buffer', async () => {
  const host = await mkHost();
  const state = { byte: 0xC3, writtenBytes: SIZE };
  stubTruncatingVm(host, state);
  const out = new Uint8Array(SIZE);

  host.renderAll6ch(HANDLE, out);           // poison
  state.writtenBytes = 0;                    // VM bailed before pixel 0
  host.renderAll6ch(HANDLE, out);

  assert.ok(out.every(b => b === 0), 'a VM that wrote nothing must produce black, not residue');
});

test('the no-outBuffer return path is zeroed too', async () => {
  const host = await mkHost();
  const state = { byte: 0x5A, writtenBytes: SIZE };
  stubTruncatingVm(host, state);

  const full = host.renderAll6ch(HANDLE);
  assert.equal(full.length, SIZE);
  assert.ok(full.every(b => b === 0x5A));

  state.writtenBytes = 6;                    // one pixel only
  const partial = host.renderAll6ch(HANDLE);
  assert.ok(partial.subarray(0, 6).every(b => b === 0x5A), 'the written pixel survives');
  assert.ok(partial.subarray(6).every(b => b === 0), 'every skipped pixel is black');
  // The returned array must be a detached copy, not a live view into the
  // reused heap block, or the next frame would mutate it under the caller.
  state.byte = 0x11;
  state.writtenBytes = SIZE;
  host.renderAll6ch(HANDLE);
  assert.ok(partial.subarray(0, 6).every(b => b === 0x5A),
    'the returned buffer must not alias the WASM heap');
});

test('the render block is allocated ONCE and reused across frames', async () => {
  const host = await mkHost();
  stubTruncatingVm(host, { byte: 0x01, writtenBytes: SIZE });
  const out = new Uint8Array(SIZE);

  host.renderAll6ch(HANDLE, out);
  const ptr = host.renderScratchPtr;
  assert.ok(ptr > 0, 'render scratch must be allocated');
  assert.equal(host.renderScratchCapacity, SIZE);
  for (let f = 0; f < 20; f++) host.renderAll6ch(HANDLE, out);
  assert.equal(host.renderScratchPtr, ptr,
    'the 40 fps path must not malloc/free per frame (that is what made the residue non-deterministic)');
});

test('renderBlend6ch zeroes its reused output block as well', async () => {
  const host = await mkHost();
  const state = { byte: 0xEE, writtenBytes: SIZE };
  host._renderBlend6ch = (_h, outPtr) => {
    host.Module.HEAPU8.fill(state.byte, outPtr, outPtr + state.writtenBytes);
  };
  const from = new Uint8Array(SIZE).fill(0x20);
  const to = new Uint8Array(SIZE).fill(0x40);
  const out = new Uint8Array(SIZE);

  host.renderBlend6ch(HANDLE, N, from, to, 0.5, out);   // poison
  assert.ok(out.every(b => b === 0xEE));

  const half = SIZE / 2;
  state.byte = 0x33;
  state.writtenBytes = half;
  host.renderBlend6ch(HANDLE, N, from, to, 0.5, out);

  assert.ok(out.subarray(0, half).every(b => b === 0x33), 'written blend pixels survive');
  assert.ok(out.subarray(half).every(b => b === 0), 'skipped blend pixels must be black');
});

test('the REAL VM still renders exactly what it did before the zeroing', async () => {
  // Behaviour preservation, not just safety: every pixel the VM writes must be
  // bit-identical across frames, through the real vendored WASM.
  const host = await mkHost();
  const compiled = host.compile(`
export function beforeRender(delta) {}
export function render3D(index, x, y, z) { rgbwau(0.25, 0.5, 0.75, 0.125, 0.375, 0.625); }
`);
  assert.equal(compiled.ok, true, `pattern must compile: ${compiled.error}`);

  host.beginFrame(compiled.handle, 0);
  const a = host.renderAll6ch(compiled.handle).slice();
  host.beginFrame(compiled.handle, 0.025);
  const b = host.renderAll6ch(compiled.handle).slice();

  assert.deepEqual(Array.from(a), Array.from(b), 'a constant pattern must be frame-stable');
  assert.ok(a.some(v => v !== 0), 'the real VM must actually have written colour');
  // A constant pattern lights every pixel: no slot may be black, which also
  // proves the zeroing did not clobber real output.
  for (let i = 0; i < N; i++) {
    const px = a.subarray(i * 6, i * 6 + 6);
    assert.ok(px.some(v => v !== 0), `pixel ${i} came out black through the real VM`);
  }
  host.destroy(compiled.handle);
});
