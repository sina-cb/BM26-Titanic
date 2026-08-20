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
  const mixer = new PatternMixer({ wasmHost, pixelCount: 4, maxChannels: 4 });
  mixer.blendHandles.trans_crossfade = { id: 'trans_crossfade' };
  return mixer;
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

test('Deck landing atomically promotes the incoming handle and its phase clock', () => {
  const host = makeWasmHostStub();
  const mixer = makeMixer(host);
  const outgoing = { id: 'outgoing' };
  const incoming = { id: 'incoming' };
  mixer.setDeckChannel({ id: 'ch_base', name: 'Base', pattern: 'p_a', handle: outgoing });
  mixer.deckChannel._phaseSeconds = 12.5;
  mixer.deckChannel._lastPhaseElapsed = 20;
  mixer.triggerDeckPatternSwap({ newHandle: incoming, patternName: 'p_b', durationMs: 1000 });
  mixer._inactiveDeckChannel._phaseSeconds = 1.25;
  mixer._inactiveDeckChannel._lastPhaseElapsed = 20;

  mixer.finishDeckSwapNow();

  assert.equal(mixer.deckChannel.handle, incoming);
  assert.equal(mixer.deckChannel.pattern, 'p_b');
  assert.equal(mixer.deckChannel._phaseSeconds, 1.25);
  assert.equal(mixer.deckChannel._lastPhaseElapsed, 20);
  assert.equal(mixer._inactiveDeckChannel.handle, outgoing);
  assert.equal(mixer._inactiveDeckChannel._phaseSeconds, 12.5);
  assert.equal(mixer.isInactiveDeckHandleFresh(), false);
});

test('a demoted, previously-running handle cannot be reused as a fresh incoming phase', () => {
  const mixer = makeMixer(makeWasmHostStub());
  mixer.setDeckChannel({ id: 'ch_base', name: 'Base', pattern: 'p_a', handle: { id: 'a' } });
  mixer.triggerDeckPatternSwap({ newHandle: { id: 'b' }, patternName: 'p_b', durationMs: 1000 });
  mixer.finishDeckSwapNow();

  assert.throws(
    () => mixer.triggerDeckPatternSwap({ newHandle: null, patternName: 'p_a', durationMs: 1000 }),
    /no fresh precompiled handle is parked/,
  );
});

test('a parked precompiled handle stays eligible for deterministic zero-phase reuse', () => {
  const mixer = makeMixer(makeWasmHostStub());
  mixer.setDeckChannel({ id: 'ch_base', name: 'Base', pattern: 'p_a', handle: { id: 'a' } });
  const parked = { id: 'b' };
  assert.equal(mixer.warmInactiveDeckHandle('p_b', parked), true);
  assert.equal(mixer.isInactiveDeckHandleFresh(), true);
  assert.ok(mixer.triggerDeckPatternSwap({ newHandle: null, patternName: 'p_b', durationMs: 1000 }));
});

test('a parked precompile does not advance until its transition starts', () => {
  const host = makeWasmHostStub();
  const calls = [];
  host.beginFrame = (handle, phase) => calls.push({ handle, phase });
  const mixer = makeMixer(host);
  const active = { id: 'a' };
  const parked = { id: 'b' };
  mixer.setDeckChannel({ id: 'ch_base', name: 'Base', pattern: 'p_a', handle: active });
  mixer.forceLayerSetting('deck', 'test');
  mixer.warmInactiveDeckHandle('p_b', parked);

  mixer.beginFrame(10);
  assert.equal(calls.some((call) => call.handle === parked), false, 'parked B must remain zero-phase');

  mixer.triggerDeckPatternSwap({ newHandle: null, patternName: 'p_b', durationMs: 1000 });
  mixer.beginFrame(10.025);
  assert.equal(calls.some((call) => call.handle === parked), true, 'B begins ticking only after selection');
  assert.ok(mixer._inactiveDeckChannel._phaseSeconds <= 0.0251);
});

test('an unknown Deck transition fails loudly and never becomes a crossfade', () => {
  const host = makeWasmHostStub();
  const mixer = makeMixer(host);
  mixer.setDeckChannel({ id: 'ch_base', name: 'Base', pattern: 'p_a', handle: { id: 'a' } });
  const incoming = { id: 'b' };
  assert.throws(
    () => mixer.triggerDeckPatternSwap({
      newHandle: incoming,
      patternName: 'p_b',
      transitionMode: 'trans_does_not_exist',
      durationMs: 1000,
    }),
    /invalid Deck transition mode/,
  );
  assert.equal(mixer.isDeckSwapInFlight(), false);
  assert.ok(host.destroyed.includes(incoming), 'failed transition must release incoming handle');
});

test('a cataloged transition with no compiled script fails loudly', () => {
  const host = makeWasmHostStub();
  const mixer = makeMixer(host);
  mixer.setDeckChannel({ id: 'ch_base', name: 'Base', pattern: 'p_a', handle: { id: 'a' } });
  const incoming = { id: 'b' };
  assert.throws(
    () => mixer.triggerDeckPatternSwap({
      newHandle: incoming,
      patternName: 'p_b',
      transitionMode: 'trans_flash',
      durationMs: 1000,
    }),
    /missing or failed to compile/,
  );
  assert.equal(mixer.isDeckSwapInFlight(), false);
  assert.ok(host.destroyed.includes(incoming));
});

test('Deck crossfade dispatches trans_crossfade, never blend_screen', () => {
  let usedBlendHandle = null;
  const host = {
    destroy() {},
    beginFrame() {},
    getExports() { return []; },
    renderAll6ch(handle, output) { output.fill(handle.value); return output; },
    renderBlend6ch(handle, _count, from, to, progress, output = null) {
      usedBlendHandle = handle;
      const target = output || new Uint8Array(from.length);
      for (let i = 0; i < target.length; i++) {
        target[i] = Math.round(from[i] + (to[i] - from[i]) * progress);
      }
      return target;
    },
  };
  const mixer = new PatternMixer({ wasmHost: host, pixelCount: 4, maxChannels: 4 });
  const crossfadeHandle = { id: 'trans_crossfade' };
  mixer.blendHandles.trans_crossfade = crossfadeHandle;
  mixer.blendHandles.blend_screen = { id: 'blend_screen' };
  mixer.setDeckChannel({ id: 'ch_base', name: 'Base', pattern: 'p_a', handle: { value: 20 } });
  mixer.forceLayerSetting('deck', 'test');
  mixer.triggerDeckPatternSwap({
    newHandle: { value: 180 },
    patternName: 'p_b',
    transitionMode: 'trans_crossfade',
    durationMs: 1000,
  });
  mixer._inactiveDeckChannel.fader = 0.5;

  const output = mixer.renderAll6ch();
  assert.equal(usedBlendHandle, crossfadeHandle);
  assert.equal(output[0], 100, 'true midpoint interpolation');
});

test('mixer crossfade also installs the real trans_crossfade script at exact progress zero', () => {
  const mixer = makeMixer(makeWasmHostStub());
  mixer.addMixerChannel({
    id: 'overlay_a', name: 'A', pattern: 'p_a', handle: { id: 'a' },
    mode: 'blend_screen', enabled: true, fader: 1,
  });
  const target = mixer.addMixerChannel({
    id: 'overlay_b', name: 'B', pattern: 'p_b', handle: { id: 'b' },
    mode: 'blend_screen', enabled: true, fader: 0,
  });

  const id = mixer.triggerMixerTransition({
    targetChannelId: 'overlay_b',
    durationMs: 1000,
    transitionMode: 'trans_crossfade',
  });

  assert.ok(id);
  assert.equal(target.mode, 'trans_crossfade');
  assert.equal(target._savedMode, 'blend_screen');
  assert.equal(target.fader, 0, 'first frame must be the exact A endpoint');
});

test('mixer transition rejects a removed/unknown id without mutating channel state', () => {
  const mixer = makeMixer(makeWasmHostStub());
  const target = mixer.addMixerChannel({
    id: 'overlay_b', name: 'B', pattern: 'p_b', handle: { id: 'b' },
    mode: 'blend_screen', enabled: false, fader: 0.4,
  });

  assert.equal(mixer.triggerMixerTransition({
    targetChannelId: 'overlay_b',
    durationMs: 1000,
    transitionMode: 'trans_morse_blink',
  }), null);
  assert.equal(target.mode, 'blend_screen');
  assert.equal(target.enabled, false);
  assert.equal(target.fader, 0.4);
  assert.equal(mixer.transitions.length, 0);
});
