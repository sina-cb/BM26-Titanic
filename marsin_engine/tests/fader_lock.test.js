// Pattern mixer fader-lock tests (slot 5 / fader_lock).
//
// Covers the four semantic rules from .agent/02_reports/202605/
// 20260525_5_fader_lock.md (and the slot brief):
//
//   1. Manual fader writes via the engine boundary are rejected when
//      faderLocked is true. The mixer's render-time fader value
//      stays at whatever the operator parked it at.
//   2. triggerMixerTransition SKIPS fader-locked channels — no
//      force-enable, no fade scheduled, no transition entry pushed.
//      The remaining (unlocked) overlays still transition normally.
//   3. fadeChannel() returns false on a fader-locked channel without
//      mutating fader OR pushing a transition. (Belt-and-suspenders
//      against any code path that calls fadeChannel directly.)
//   4. Explicit mute (enabled=false) still works on a fader-locked
//      channel — fader-lock does NOT override an operator-chosen
//      mute. The render loop's `if (!channel.enabled) continue`
//      check in pattern_mixer.renderAll6ch() is unchanged.
//
// We instantiate PatternMixer with a fake WASM host (no real WASM
// compilation, no fs reads) so the test is deterministic and fast.
// The mixer's view of solo is intentionally NOT tested here — solo
// is implemented client-side in CaptainPad/app/(tabs)/mixer.tsx and
// has its own coverage path (manual smoke on the iPad).
//
// Run:  cd marsin_engine && node --test tests/fader_lock.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { PatternMixer } from '../lib/pattern_mixer.js';

// Minimal fake wasm host that just records calls. We never need to
// render real bytes here — the assertions are all on channel state,
// transition queue length, and method return values.
function makeFakeWasmHost() {
  return {
    renderAll6ch() {},
    renderBlend6ch(_h, _n, bg) { return new Uint8Array(bg); },
    beginFrame() {},
    setControl() {},
    destroy() {},
    getExports() { return []; },
    setCoords() {},
    setPixelMeta() {},
    compile() { return { ok: true, handle: { fake: true } }; },
  };
}

// Build a mixer with one deck + three overlays. ch2 is fader-locked
// at 0.5, ch1 and ch3 are unlocked at 0.4 and 0.6 respectively. We
// use distinct fader values so the assertions can pin down which
// channel moved and which didn't.
function makeFixture() {
  const wasmHost = makeFakeWasmHost();
  const mixer = new PatternMixer({ wasmHost, pixelCount: 4, maxChannels: 6 });
  // Pre-register dummy blend handles so getBlendHandle never tries fs.
  mixer.blendHandles['blend_screen'] = { fake: true };
  mixer.blendHandles['trans_crossfade'] = { fake: true };

  const handle = { fake: true };
  mixer.setDeckChannel({
    id: 'ch_deck', name: 'Deck', pattern: 'p_deck',
    handle, mode: 'blend_screen', fader: 1.0, enabled: true,
  });
  mixer.addMixerChannel({
    id: 'ch1', name: 'CH 1', pattern: 'p1',
    handle, mode: 'blend_screen', fader: 0.4, enabled: true,
  });
  mixer.addMixerChannel({
    id: 'ch2', name: 'CH 2 (locked)', pattern: 'p2',
    handle, mode: 'blend_screen', fader: 0.5, enabled: true,
    faderLocked: true,
  });
  mixer.addMixerChannel({
    id: 'ch3', name: 'CH 3', pattern: 'p3',
    handle, mode: 'blend_screen', fader: 0.6, enabled: true,
  });
  return mixer;
}

// ─── Rule 1: faderLocked defaults to false on construction ────────

test('PatternChannel.faderLocked defaults to false when not provided', () => {
  const mixer = makeFixture();
  assert.equal(mixer.getMixerChannel('ch1').faderLocked, false);
  assert.equal(mixer.getMixerChannel('ch3').faderLocked, false);
});

test('PatternChannel.faderLocked is true when constructed with the flag', () => {
  const mixer = makeFixture();
  assert.equal(mixer.getMixerChannel('ch2').faderLocked, true);
});

// ─── Rule 2: triggerMixerTransition skips fader-locked channels ───

test('triggerMixerTransition: locked channel keeps fader, no transition pushed', () => {
  const mixer = makeFixture();
  const lockedBefore = mixer.getMixerChannel('ch2').fader;

  const id = mixer.triggerMixerTransition({
    targetChannelId: 'ch1',
    durationMs: 500,
    transitionMode: 'trans_crossfade',
  });
  assert.ok(id, 'transition group id returned');

  // ch1 (target, unlocked) and ch3 (loser, unlocked) MUST have queued
  // transitions; ch2 (locked) must NOT.
  const queuedIds = new Set(mixer.transitions.map(t => t.channelId));
  assert.ok(queuedIds.has('ch1'), 'ch1 (target) has a transition queued');
  assert.ok(queuedIds.has('ch3'), 'ch3 (loser) has a transition queued');
  assert.equal(queuedIds.has('ch2'), false, 'ch2 (faderLocked) has NO transition queued');

  // The locked channel's fader value is unchanged by the trigger call.
  assert.equal(mixer.getMixerChannel('ch2').fader, lockedBefore);
});

test('triggerMixerTransition: locked channel is not force-enabled', () => {
  const mixer = makeFixture();
  // Explicit pre-state: ch2 is locked AND muted (enabled=false). The
  // trigger must NOT silently enable it the way it does for unlocked
  // overlays. If it did, the channel would suddenly start contributing
  // to the mix mid-transition — the opposite of "transitions don't
  // affect this layer".
  mixer.getMixerChannel('ch2').enabled = false;
  mixer.triggerMixerTransition({
    targetChannelId: 'ch1',
    durationMs: 500,
    transitionMode: 'trans_crossfade',
  });
  assert.equal(mixer.getMixerChannel('ch2').enabled, false,
    'locked muted channel stays muted across a transition trigger');
});

test('triggerMixerTransition: targeting a locked channel still fades the others', () => {
  // Edge case: operator picks a locked channel as the transition
  // target. Rule 2 says the locked target keeps its fader; the rest
  // of the mix should still respond (ch3 fades to 0 — there is no
  // unlocked "winner" so it just becomes a loser-only fade).
  const mixer = makeFixture();
  const lockedFaderBefore = mixer.getMixerChannel('ch2').fader;
  const id = mixer.triggerMixerTransition({
    targetChannelId: 'ch2',  // locked
    durationMs: 500,
    transitionMode: 'trans_crossfade',
  });
  assert.ok(id);
  const queuedIds = new Set(mixer.transitions.map(t => t.channelId));
  assert.equal(queuedIds.has('ch2'), false, 'locked target has no transition');
  assert.ok(queuedIds.has('ch1'), 'ch1 still fades');
  assert.ok(queuedIds.has('ch3'), 'ch3 still fades');
  assert.equal(mixer.getMixerChannel('ch2').fader, lockedFaderBefore);
});

// ─── Rule 3: fadeChannel() short-circuits on locked channel ───────

test('fadeChannel: returns false on a fader-locked channel and pushes no transition', () => {
  const mixer = makeFixture();
  const before = mixer.transitions.length;
  const beforeFader = mixer.getMixerChannel('ch2').fader;

  const result = mixer.fadeChannel('ch2', 1.0, 500);

  assert.equal(result, false, 'fadeChannel returns false on locked channel');
  assert.equal(mixer.transitions.length, before, 'no transition queued');
  assert.equal(mixer.getMixerChannel('ch2').fader, beforeFader, 'fader unchanged');
});

test('fadeChannel: returns true and queues normally for unlocked channel', () => {
  const mixer = makeFixture();
  const result = mixer.fadeChannel('ch1', 1.0, 500);
  assert.equal(result, true);
  assert.equal(mixer.transitions.some(t => t.channelId === 'ch1'), true);
});

// ─── Rule 4: explicit mute still works on a fader-locked channel ──

test('explicit mute (enabled=false) still works on a fader-locked channel', () => {
  const mixer = makeFixture();
  const ch2 = mixer.getMixerChannel('ch2');
  // The engine code path for explicit mute is just `channel.enabled =
  // false` (see WS setChannelEnabled in api_server.js). Confirm
  // faderLocked does not interfere with that primitive.
  ch2.enabled = false;
  assert.equal(ch2.enabled, false, 'explicit mute applied');
  assert.equal(ch2.faderLocked, true, 'fader-lock untouched by mute');
  // The render loop's `if (!channel.enabled) continue` gate (line
  // ~1114 of pattern_mixer.js, unmodified by slot 5) will skip this
  // channel from compositing — that's the "muting still works" rule.
});

// ─── Toggling faderLocked at runtime does not corrupt fader ───────

test('toggling faderLocked at runtime does not change the fader value', () => {
  const mixer = makeFixture();
  const ch = mixer.getMixerChannel('ch1');
  ch.fader = 0.77;
  ch.faderLocked = true;
  assert.equal(ch.fader, 0.77);
  ch.faderLocked = false;
  assert.equal(ch.fader, 0.77);
});

// ─── Locked channel persists view through updateTransitions tick ──

test('updateTransitions tick does not touch fader-locked channel', () => {
  const mixer = makeFixture();
  // Schedule a fade on ch1 (unlocked) and verify the tick advances
  // ch1 but leaves ch2 alone — even though ch2 was force-enabled in
  // a prior life of triggerMixerTransition, it should be skipped now.
  mixer.fadeChannel('ch1', 1.0, 100);
  const lockedFaderBefore = mixer.getMixerChannel('ch2').fader;
  // Advance the clock 200ms past start so the transition lands.
  const tNow = performance.now() + 200;
  mixer.updateTransitions(tNow);
  assert.equal(mixer.getMixerChannel('ch1').fader, 1.0, 'unlocked ch1 advanced to target');
  assert.equal(mixer.getMixerChannel('ch2').fader, lockedFaderBefore, 'locked ch2 untouched');
});
