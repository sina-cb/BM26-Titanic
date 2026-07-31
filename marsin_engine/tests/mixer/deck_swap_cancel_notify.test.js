// Unit tests for the deck-swap CANCELLED notification (report
// .agent/reports/202607/20260725_14_pattern_switch_lag_debug.md, root cause 1).
//
// A cancelled deck swap deliberately does NOT run the swap's own onComplete
// closure — that would commit the cancelled target. But the api_server's
// `deckSwapComplete` broadcast lives INSIDE that closure, so before this fix
// a cancel (PANIC / look morph kickoff / deck remove / shutdown mid-fade)
// left every client that dimmed + disabled its playlist on `deckSwapStarted`
// wedged until a remount. `onDeckSwapCancelled` is the release valve.
//
// No WASM: wasmHost is stubbed and handles are plain objects, exactly like
// deck_swap_param.test.js.
//
// Run:  node --test tests/mixer/deck_swap_cancel_notify.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { PatternMixer } from '../../lib/pattern_mixer.js';

function makeWasmHostStub() {
  const destroyed = [];
  return {
    destroyed,
    destroy(h) { destroyed.push(h); },
    beginFrame() {},
    getExports() { return []; },
  };
}

function makeMixer(wasmHost) {
  return new PatternMixer({ wasmHost, pixelCount: 4, maxChannels: 4 });
}

// Start a deck + an in-flight swap onto 'p_b'. Returns the transition id.
function startSwap(m, durationMs = 5000) {
  m.setDeckChannel({ id: 'ch_base', name: 'Base', pattern: 'p_a', handle: { id: 'base' } });
  const txid = m.triggerDeckPatternSwap({
    newHandle: { id: 'incoming' },
    patternName: 'p_b',
    durationMs,
  });
  assert.ok(txid, 'swap should start');
  assert.equal(m.isDeckSwapInFlight(), true, 'swap must be in flight');
  return txid;
}

test('cancelDeckPatternSwap fires onDeckSwapCancelled with the cancelled transition id', () => {
  const m = makeMixer(makeWasmHostStub());
  const cancelled = [];
  m.onDeckSwapCancelled = (e) => cancelled.push(e);
  const txid = startSwap(m);

  assert.equal(m.cancelDeckPatternSwap(), true);
  assert.equal(cancelled.length, 1, 'exactly one cancelled notification');
  assert.equal(cancelled[0].transitionId, txid, 'must carry the cancelled swap id');
  assert.equal(m.isDeckSwapInFlight(), false, 'swap must no longer be in flight');
});

test('cancelDeckPatternSwap does NOT fire the swap onComplete (target must not commit)', () => {
  const m = makeMixer(makeWasmHostStub());
  let completes = 0;
  let globalCompletes = 0;
  m.onDeckSwapComplete = () => { globalCompletes += 1; };
  m.setDeckChannel({ id: 'ch_base', name: 'Base', pattern: 'p_a', handle: { id: 'base' } });
  m.triggerDeckPatternSwap({
    newHandle: { id: 'incoming' },
    patternName: 'p_b',
    durationMs: 5000,
    onComplete: () => { completes += 1; },
  });

  m.cancelDeckPatternSwap();
  assert.equal(completes, 0, 'per-swap onComplete must NOT run on cancel');
  assert.equal(globalCompletes, 0, 'onDeckSwapComplete must NOT run on cancel');
  assert.equal(m.getDeckChannel().pattern, 'p_a', 'deck must stay on the pre-swap pattern');
});

test('cancelDeckPatternSwap with no swap in flight is a silent no-op', () => {
  const m = makeMixer(makeWasmHostStub());
  let fired = 0;
  m.onDeckSwapCancelled = () => { fired += 1; };
  m.setDeckChannel({ id: 'ch_base', name: 'Base', pattern: 'p_a', handle: { id: 'base' } });

  assert.equal(m.cancelDeckPatternSwap(), false);
  assert.equal(fired, 0, 'no notification when there was nothing to cancel');
});

test('cancelDeckPatternSwap fires exactly once even if called repeatedly', () => {
  const m = makeMixer(makeWasmHostStub());
  let fired = 0;
  m.onDeckSwapCancelled = () => { fired += 1; };
  startSwap(m);

  m.cancelDeckPatternSwap();
  m.cancelDeckPatternSwap();
  m.cancelDeckPatternSwap();
  assert.equal(fired, 1, 'idempotent: only the real cancel notifies');
});

test('PANIC mid-fade notifies cancellation (the operator-reported wedge path)', () => {
  const m = makeMixer(makeWasmHostStub());
  const cancelled = [];
  m.onDeckSwapCancelled = (e) => cancelled.push(e);
  const txid = startSwap(m);

  m.panicToSafeDefault({ home: false });
  assert.equal(m.isDeckSwapInFlight(), false, 'panic must clear the in-flight swap');
  assert.equal(cancelled.length, 1, 'panic mid-fade must notify listeners');
  assert.equal(cancelled[0].transitionId, txid);
});

test('removeDeckChannel mid-fade notifies cancellation', () => {
  const m = makeMixer(makeWasmHostStub());
  const cancelled = [];
  m.onDeckSwapCancelled = (e) => cancelled.push(e);
  const txid = startSwap(m);

  assert.equal(m.removeDeckChannel(), true);
  assert.equal(cancelled.length, 1, 'deck removal mid-fade must notify listeners');
  assert.equal(cancelled[0].transitionId, txid);
});

test('a throwing onDeckSwapCancelled cannot break the cancel path', () => {
  const m = makeMixer(makeWasmHostStub());
  m.onDeckSwapCancelled = () => { throw new Error('listener blew up'); };
  startSwap(m);

  assert.equal(m.cancelDeckPatternSwap(), true, 'cancel must still report success');
  assert.equal(m.isDeckSwapInFlight(), false, 'state must still be clean');
});

test('re-triggering a swap mid-fade does NOT notify cancellation (a new started follows)', () => {
  const m = makeMixer(makeWasmHostStub());
  let fired = 0;
  m.onDeckSwapCancelled = () => { fired += 1; };
  startSwap(m);

  // Operator spams a second pick before the first lands: triggerDeckPatternSwap
  // drops the in-flight transition inline and immediately broadcasts its own
  // deckSwapStarted. A cancelled-notification here would race that started
  // event and could clear the client's in-flight UI for a swap that IS running.
  const txid2 = m.triggerDeckPatternSwap({
    newHandle: { id: 'incoming2' },
    patternName: 'p_c',
    durationMs: 5000,
  });
  assert.ok(txid2, 'second swap should start');
  assert.equal(fired, 0, 'swap-over-swap must not emit a cancelled notification');
  assert.equal(m.isDeckSwapInFlight(), true, 'the NEW swap is in flight');
});

test('a completed swap fires onDeckSwapComplete and never onDeckSwapCancelled', () => {
  const m = makeMixer(makeWasmHostStub());
  let cancelledFired = 0;
  const completed = [];
  m.onDeckSwapCancelled = () => { cancelledFired += 1; };
  m.onDeckSwapComplete = (e) => completed.push(e);
  startSwap(m, 20);

  m.finishDeckSwapNow();
  assert.equal(completed.length, 1, 'normal landing fires the complete callback');
  assert.equal(completed[0].pattern, 'p_b');
  assert.equal(cancelledFired, 0, 'a landed swap is not a cancellation');
  assert.equal(m.isDeckSwapInFlight(), false);
});
