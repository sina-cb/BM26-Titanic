// Unit tests for deck-swap mixer hardening (slot 2 items 6/8/9) at the
// PatternMixer level. No WASM: we stub wasmHost and use plain object handles,
// driving only the bookkeeping paths (warm-slot leak safety, swap teardown on
// deck removal, vis-buffer pooling). The transition mode stays the default
// 'trans_crossfade' so no blend script needs to compile.
//
// Run:  node --test tests/deck_swap_param.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { PatternMixer } from '../../lib/pattern_mixer.js';

// wasmHost stub that records every handle it's asked to destroy, so tests
// can assert leak-safety (every handle whose ownership transferred to the
// mixer is eventually destroyed, and none is double-freed).
function makeWasmHostStub() {
  const destroyed = [];
  return {
    destroyed,
    destroy(h) { destroyed.push(h); },
    // beginFrame is called on warm handles to seed scope; no-op here.
    beginFrame() {},
    // PatternChannel.beginFrame/renderInto won't run for fader-0 hidden
    // slots in the paths these tests exercise, but provide safe no-ops.
    getExports() { return []; },
  };
}

function makeMixer(wasmHost) {
  return new PatternMixer({ wasmHost, pixelCount: 4, maxChannels: 4 });
}

// ── item 8: warmInactiveDeckHandle leak safety ─────────────────────────

test('warmInactiveDeckHandle destroys a redundant handle when slot already holds the pattern', () => {
  const wasmHost = makeWasmHostStub();
  const m = makeMixer(wasmHost);
  const h1 = { id: 'h1' };
  assert.equal(m.warmInactiveDeckHandle('p_a', h1), true);
  assert.equal(m.getInactiveDeckPattern(), 'p_a');

  // Second call with the SAME pattern but a DIFFERENT (redundant) handle:
  // the incoming handle must be destroyed (not leaked), slot keeps h1.
  const h2 = { id: 'h2' };
  assert.equal(m.warmInactiveDeckHandle('p_a', h2), true);
  assert.ok(wasmHost.destroyed.includes(h2), 'redundant incoming handle must be destroyed');
  assert.ok(!wasmHost.destroyed.includes(h1), 'held handle must NOT be destroyed');
});

test('warmInactiveDeckHandle destroys the OLD handle when re-binding to a new pattern', () => {
  const wasmHost = makeWasmHostStub();
  const m = makeMixer(wasmHost);
  const hOld = { id: 'old' };
  const hNew = { id: 'new' };
  m.warmInactiveDeckHandle('p_a', hOld);
  m.warmInactiveDeckHandle('p_b', hNew);
  assert.equal(m.getInactiveDeckPattern(), 'p_b');
  assert.ok(wasmHost.destroyed.includes(hOld), 'old warm handle must be freed on rebind');
  assert.ok(!wasmHost.destroyed.includes(hNew), 'new handle is now live, must not be freed');
});

// ── item 9: removeDeckChannel cancels an in-flight swap first ───────────

test('removeDeckChannel cancels an in-flight deck swap and tears down the inactive slot', () => {
  const wasmHost = makeWasmHostStub();
  const m = makeMixer(wasmHost);
  m.setDeckChannel({ id: 'ch_base', name: 'Base', pattern: 'p_a', handle: { id: 'base' } });

  // Start a swap to a different pattern (default trans_crossfade ⇒ no
  // blend-script compile needed). This installs the inactive slot and an
  // in-flight _swapTransition.
  const incoming = { id: 'incoming' };
  const txid = m.triggerDeckPatternSwap({ newHandle: incoming, patternName: 'p_b', durationMs: 5000 });
  assert.ok(txid, 'swap should start');
  assert.equal(m.isDeckSwapInFlight(), true, 'swap must be in flight');

  // Removing the deck must cancel the swap FIRST, then destroy the inactive
  // handle — no use-after-free, no leak.
  assert.equal(m.removeDeckChannel(), true);
  assert.equal(m.isDeckSwapInFlight(), false, 'swap must no longer be in flight');
  assert.equal(m.getDeckChannel(), null, 'deck must be gone');
  assert.equal(m.getInactiveDeckPattern(), null, 'inactive slot must be torn down');
  assert.ok(wasmHost.destroyed.includes(incoming), 'inactive handle must be destroyed (no leak)');
});

// ── item 6: vis buffer pool reuse ──────────────────────────────────────

test('_extractVisInto reuses the same buffer object per key across frames', () => {
  const wasmHost = makeWasmHostStub();
  const m = makeMixer(wasmHost);
  const src1 = new Uint8Array([1, 2, 3, 4, 5, 6]);
  const a = m._extractVisInto('master', src1);
  const src2 = new Uint8Array([9, 8, 7, 6, 5, 4]);
  const b = m._extractVisInto('master', src2);
  assert.equal(a, b, 'same key must reuse the same backing buffer (no per-frame alloc)');
  assert.deepEqual([...b], [9, 8, 7, 6, 5, 4], 'buffer must hold the latest frame data');
});

test('_extractVisInto keeps DISTINCT buffers per key (no cross-channel corruption)', () => {
  const wasmHost = makeWasmHostStub();
  const m = makeMixer(wasmHost);
  const deck = m._extractVisInto('ch_deck', new Uint8Array([1, 1, 1, 1, 1, 1]));
  const overlay = m._extractVisInto('ch_o1', new Uint8Array([2, 2, 2, 2, 2, 2]));
  assert.notEqual(deck, overlay, 'different keys must NOT share a buffer');
  assert.deepEqual([...deck], [1, 1, 1, 1, 1, 1]);
  assert.deepEqual([...overlay], [2, 2, 2, 2, 2, 2]);
});
