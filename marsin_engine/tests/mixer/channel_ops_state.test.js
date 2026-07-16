// Unit tests for the CHANNEL OPS cluster engine methods (#7 Reorder, #9 Panic).
// Exercises the PatternMixer methods directly (no engine boot) — the
// route/duplicate paths are covered end-to-end by tests/hil/hil_channel_ops_test.mjs.
//
// Run:  cd marsin_engine && node --test tests/channel_ops_state.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { PatternChannel } from '../../lib/pattern_channel.js';
import { PatternMixer } from '../../lib/pattern_mixer.js';

function makeFakeWasmHost() {
  return {
    renderAll6ch() {}, renderBlend6ch(h, n, bg) { return new Uint8Array(bg.length); },
    beginFrame() {}, setControl() {}, destroy() {}, getExports() { return []; },
    compile() { return { ok: true, handle: {} }; },
  };
}
function makeMixer(maxChannels = 6) {
  return new PatternMixer({ wasmHost: makeFakeWasmHost(), pixelCount: 2, maxChannels });
}
function addCh(m, id, extra = {}) {
  return m.addMixerChannel({ id, name: id, pattern: 'p', handle: {}, enabled: true, fader: 1, ...extra });
}

// ── #7 REORDER ──────────────────────────────────────────────────────────────
test('reorderMixerChannels reverses the stack, SAME objects preserved by ref', () => {
  const m = makeMixer();
  const a = addCh(m, 'a'); const b = addCh(m, 'b'); const c = addCh(m, 'c');
  const result = m.reorderMixerChannels(['c', 'b', 'a']);
  assert.deepEqual(result.map(x => x.id), ['c', 'b', 'a']);
  // Object identity preserved — no new PatternChannel, no recompile.
  assert.equal(m.getMixerChannels()[0], c);
  assert.equal(m.getMixerChannels()[1], b);
  assert.equal(m.getMixerChannels()[2], a);
});

test('reorder preserves handles / masks / mixGroupId / soloSafe (by ref)', () => {
  const m = makeMixer();
  const a = addCh(m, 'a', { soloSafe: true });
  const b = addCh(m, 'b');
  const g = m.createMixGroup({});
  m.addChannelToGroup(g.id, 'b');
  const aHandle = a.handle; const aMask = a.compiledPixelMask;
  m.reorderMixerChannels(['b', 'a']);
  const a2 = m.getMixerChannel('a');
  const b2 = m.getMixerChannel('b');
  assert.equal(a2.handle, aHandle, 'handle survives reorder');
  assert.equal(a2.compiledPixelMask, aMask, 'compiled mask survives reorder');
  assert.equal(a2.soloSafe, true, 'soloSafe survives reorder');
  assert.equal(b2.mixGroupId, g.id, 'mixGroupId survives reorder');
});

test('reorder is atomic single reassignment (no splice intermediate loss)', () => {
  const m = makeMixer();
  addCh(m, 'a'); addCh(m, 'b'); addCh(m, 'c');
  const before = new Set(m.getMixerChannels().map(c => c.id));
  m.reorderMixerChannels(['b', 'c', 'a']);
  const after = new Set(m.getMixerChannels().map(c => c.id));
  assert.deepEqual([...after].sort(), [...before].sort(), 'no channel lost or added');
  assert.equal(m.getMixerChannels().length, 3);
});

test('reorder rejects bad sets (throws — fail loud, no partial apply)', () => {
  const m = makeMixer();
  addCh(m, 'a'); addCh(m, 'b');
  assert.throws(() => m.reorderMixerChannels(['a']), /length/, 'wrong length');
  assert.throws(() => m.reorderMixerChannels(['a', 'a']), /duplicate/, 'duplicate id');
  assert.throws(() => m.reorderMixerChannels(['a', 'z']), /not a current/, 'unknown id');
  assert.throws(() => m.reorderMixerChannels('nope'), /must be an array/, 'non-array');
  // Stack untouched after a failed reorder.
  assert.deepEqual(m.getMixerChannels().map(c => c.id), ['a', 'b']);
});

test('reorder accepted mid scripted transition; transitions key on id', () => {
  const m = makeMixer();
  addCh(m, 'a'); addCh(m, 'b'); addCh(m, 'c');
  const txid = m.triggerMixerTransition({ targetChannelId: 'c', durationMs: 1000, transitionMode: 'trans_crossfade' });
  assert.ok(txid, 'transition started');
  const txBefore = m.transitions.map(t => t.channelId).sort();
  // Reorder while the transition is in flight — must not throw, must not
  // drop or rebind transitions (they key on channelId, not array index).
  m.reorderMixerChannels(['c', 'a', 'b']);
  const txAfter = m.transitions.map(t => t.channelId).sort();
  assert.deepEqual(txAfter, txBefore, 'transitions intact across reorder');
  assert.deepEqual(m.getMixerChannels().map(c => c.id), ['c', 'a', 'b']);
});

// ── #9 PANIC ──────────────────────────────────────────────────────────────
test('panicToSafeDefault: master=1, overlays enabled+full, fade/solo cleared', () => {
  const m = makeMixer();
  const a = addCh(m, 'a', { enabled: false, fader: 0 });
  const b = addCh(m, 'b', { fader: 0.3 });
  m.startMasterFade(0, 5000);            // master fade in flight
  m.setSolo('b');                        // solo gate active
  m.fadeChannel('a', 1.0, 5000);         // a transition in flight
  assert.ok(m._masterFade, 'master fade armed');
  assert.equal(m.soloedChannelIds.size, 1);

  m.panicToSafeDefault();

  assert.equal(m.master, 1.0, 'master forced to full');
  assert.equal(m._masterFade, null, 'master fade cancelled');
  assert.equal(m.transitions.length, 0, 'all transitions cancelled');
  assert.equal(m.soloedChannelIds.size, 0, 'solo cleared');
  assert.equal(a.enabled, true, 'disabled overlay re-enabled');
  assert.equal(a.fader, 1.0, 'overlay fader to full');
  assert.equal(b.fader, 1.0, 'overlay fader to full');
  assert.equal(m.scriptedTransitionTargetId, null);
});

test('panicToSafeDefault respects faderLocked (parked level preserved)', () => {
  const m = makeMixer();
  const a = addCh(m, 'a', { fader: 0.25, faderLocked: true });
  m.panicToSafeDefault();
  assert.equal(a.fader, 0.25, 'locked fader NOT changed by panic');
  assert.equal(a.enabled, true, 'still force-enabled though');
});

test('panicToSafeDefault never touches faderMax (safety ceiling)', () => {
  const m = makeMixer();
  const a = addCh(m, 'a', { fader: 1.0, faderMax: 0.5 });
  m.panicToSafeDefault();
  assert.equal(a.faderMax, 0.5, 'faderMax ceiling untouched');
});

test('panicToSafeDefault un-mutes groups without deleting them', () => {
  const m = makeMixer();
  addCh(m, 'a');
  const g = m.createMixGroup({});
  m.addChannelToGroup(g.id, 'a');
  m.updateMixGroup(g.id, { muted: true, fader: 0.4 });
  m.panicToSafeDefault();
  const g2 = m.getMixGroup(g.id);
  assert.ok(g2, 'group still exists');
  assert.equal(g2.muted, false, 'group un-muted');
  assert.equal(g2.fader, 0.4, 'group fader NOT reset (only mute cleared)');
  assert.equal(m.getMixerChannel('a').mixGroupId, g.id, 'membership preserved');
});

test('panicToSafeDefault cancels an in-flight deck swap without committing', () => {
  const m = makeMixer();
  // Install a deck + an inactive sibling and start a swap.
  m.setDeckChannel({ id: 'ch_base', name: 'Base', pattern: 'pA', handle: {}, enabled: true });
  const txid = m.triggerDeckPatternSwap({ newHandle: {}, patternName: 'pB', durationMs: 2000 });
  assert.ok(txid, 'deck swap started');
  assert.equal(m.isDeckSwapInFlight(), true);
  m.panicToSafeDefault();
  assert.equal(m.isDeckSwapInFlight(), false, 'deck swap cancelled');
  // Deck kept its KNOWN-LIT current pattern (not committed to the half-chosen target).
  assert.equal(m.getDeckChannel().pattern, 'pA', 'deck stayed on current pattern (not finished)');
});
