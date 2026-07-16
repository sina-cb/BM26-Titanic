// Unit tests for channel FOLLOW/LINK (round-2 #6, docs/39 §F-follow).
//
// A follower channel's `followLeaderId` makes its composite INPUT track the
// leader's EFFECTIVE level (post group/solo/faderMax) × the follower's own
// `followScale`, REPLACING the follower's manual fader. The follower's OWN
// faderMax / solo / enabled gates STILL apply on top. Resolution is
// previous-frame: each renderAll6ch() snapshots every channel's effective
// fader into mixer._prevEffFaderCache, which the NEXT frame's followers read
// (one frame of latency per chain hop — acceptable for lighting).
//
// These tests drive a fake WASM host (renderAll6ch touches no real WASM) and
// step frames by calling mixer.renderAll6ch() — exactly the loop that
// populates the prev-frame cache.
//
// Run:  cd marsin_engine && node --test tests/follow_link.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { PatternChannel } from '../../lib/pattern_channel.js';
import { PatternMixer } from '../../lib/pattern_mixer.js';
import { serializeChannel } from '../../lib/state_manager.js';

function makeFakeWasmHost() {
  return {
    renderAll6ch() {}, renderBlend6ch(h, n, bg) { return new Uint8Array(bg.length); },
    beginFrame() {}, setControl() {}, destroy() {}, getExports() { return []; },
    compile() { return { ok: true, handle: {} }; },
  };
}
function makeMixer() {
  const mixer = new PatternMixer({ wasmHost: makeFakeWasmHost(), pixelCount: 2 });
  mixer.wantVisThisFrame = false;
  return mixer;
}

// Add a mixer overlay with a handle so _effFader treats it as live. The fake
// host's renderAll6ch/renderBlend6ch are no-ops; we only care about the
// effective-fader cache the render loop publishes.
function addCh(mixer, cfg) {
  return mixer.addMixerChannel({ handle: {}, ...cfg });
}

// Advance one render frame so _prevEffFaderCache is repopulated, then return
// the follower's effective fader as the composite would compute it THIS frame
// (i.e. reading the cache the just-finished frame published).
function effAfterFrame(mixer, channelId) {
  mixer.renderAll6ch();
  const soloActive = mixer.soloedChannelIds.size > 0;
  return mixer._effFader(mixer.getChannel(channelId), soloActive);
}

// Run enough frames for an N-hop chain's prev-frame latency to settle.
function settle(mixer, frames) {
  for (let i = 0; i < frames; i++) mixer.renderAll6ch();
}

// ── PatternChannel defaults / typing ──────────────────────────────────────
test('PatternChannel defaults: followLeaderId null, followScale 1.0', () => {
  const c = new PatternChannel({ id: 'a', name: 'A', pattern: 'p' });
  assert.equal(c.followLeaderId, null);
  assert.equal(c.followScale, 1.0);
});

test('PatternChannel types/clamps follow fields defensively', () => {
  const c = new PatternChannel({ id: 'a', name: 'A', pattern: 'p', followLeaderId: 42, followScale: 99 });
  assert.equal(c.followLeaderId, null, 'non-string followLeaderId coerces to null');
  assert.equal(c.followScale, 2.0, 'followScale clamps to [0,2] upper bound');
  const c2 = new PatternChannel({ id: 'b', name: 'B', pattern: 'p', followScale: -5 });
  assert.equal(c2.followScale, 0, 'followScale clamps to [0,2] lower bound');
  const c3 = new PatternChannel({ id: 'c', name: 'C', pattern: 'p', followScale: NaN });
  assert.equal(c3.followScale, 1.0, 'non-finite followScale restores to default 1.0');
});

// ── Follower tracks leader effective × scale ──────────────────────────────
test('follower tracks leader effective fader (scale 1.0)', () => {
  const m = makeMixer();
  const leader = addCh(m, { id: 'L', name: 'L', pattern: 'p', fader: 0.8 });
  const follower = addCh(m, { id: 'F', name: 'F', pattern: 'p', fader: 0.1, followLeaderId: 'L' });
  // Frame 1 publishes leader's 0.8; frame 2 the follower reads it.
  settle(m, 1);
  assert.ok(Math.abs(effAfterFrame(m, 'F') - 0.8) < 1e-9, 'follower tracks leader 0.8');
  // Drive the leader to 0.4; follower follows after the prev-frame hop.
  leader.fader = 0.4;
  settle(m, 1);
  assert.ok(Math.abs(effAfterFrame(m, 'F') - 0.4) < 1e-9, 'follower tracks leader 0.4');
});

test('follower applies followScale to the leader effective level', () => {
  const m = makeMixer();
  addCh(m, { id: 'L', name: 'L', pattern: 'p', fader: 0.6 });
  addCh(m, { id: 'F', name: 'F', pattern: 'p', fader: 1.0, followLeaderId: 'L', followScale: 0.5 });
  settle(m, 2);
  assert.ok(Math.abs(effAfterFrame(m, 'F') - 0.3) < 1e-9, 'follower = 0.6 × 0.5 = 0.3');
});

// ── Follower's OWN faderMax still caps ─────────────────────────────────────
test("follower's own faderMax still caps the followed level", () => {
  const m = makeMixer();
  addCh(m, { id: 'L', name: 'L', pattern: 'p', fader: 1.0 });
  // Leader full (1.0), scale 1.0 → followed input 1.0, but follower faderMax 0.3.
  addCh(m, { id: 'F', name: 'F', pattern: 'p', fader: 1.0, followLeaderId: 'L', faderMax: 0.3 });
  settle(m, 2);
  assert.ok(Math.abs(effAfterFrame(m, 'F') - 0.3) < 1e-9, "follower capped at its own faderMax 0.3");
});

test("following NEVER alters the leader's own effective level", () => {
  const m = makeMixer();
  const leader = addCh(m, { id: 'L', name: 'L', pattern: 'p', fader: 0.7 });
  addCh(m, { id: 'F', name: 'F', pattern: 'p', fader: 0.2, followLeaderId: 'L', followScale: 2.0 });
  settle(m, 2);
  // The leader's effective fader must be exactly its own 0.7 regardless of the
  // follower (and the follower's 2× scale must not bleed into the leader).
  assert.ok(Math.abs(effAfterFrame(m, 'L') - 0.7) < 1e-9, 'leader unchanged by follower');
  assert.equal(leader.fader, 0.7, "leader's manual fader untouched");
});

// ── Self-follow + cycle rejection (mixer graph helper) ─────────────────────
test('self-follow is detected as a cycle', () => {
  const m = makeMixer();
  addCh(m, { id: 'A', name: 'A', pattern: 'p' });
  assert.equal(m.wouldCreateFollowCycle('A', 'A'), true, 'A→A is a self-follow cycle');
});

test('A→B→A is detected as a cycle', () => {
  const m = makeMixer();
  addCh(m, { id: 'A', name: 'A', pattern: 'p' });
  addCh(m, { id: 'B', name: 'B', pattern: 'p', followLeaderId: 'A' }); // B follows A
  // Now ask: may A follow B? That closes A→B→A.
  assert.equal(m.wouldCreateFollowCycle('A', 'B'), true, 'A following B closes A→B→A');
});

test('longer cycle A→B→C→A is detected', () => {
  const m = makeMixer();
  addCh(m, { id: 'A', name: 'A', pattern: 'p' });
  addCh(m, { id: 'B', name: 'B', pattern: 'p', followLeaderId: 'A' }); // B→A
  addCh(m, { id: 'C', name: 'C', pattern: 'p', followLeaderId: 'B' }); // C→B
  // May A follow C? That closes A→C→B→A.
  assert.equal(m.wouldCreateFollowCycle('A', 'C'), true, 'A following C closes the 3-cycle');
});

// ── Acyclic chain A→B→C resolves ───────────────────────────────────────────
test('acyclic chain A follows B follows C is allowed and resolves', () => {
  const m = makeMixer();
  const C = addCh(m, { id: 'C', name: 'C', pattern: 'p', fader: 0.8 });
  addCh(m, { id: 'B', name: 'B', pattern: 'p', fader: 0.1, followLeaderId: 'C' }); // B→C
  addCh(m, { id: 'A', name: 'A', pattern: 'p', fader: 0.1, followLeaderId: 'B' }); // A→B
  // No cycle for any of these links.
  assert.equal(m.wouldCreateFollowCycle('B', 'C'), false);
  assert.equal(m.wouldCreateFollowCycle('A', 'B'), false);
  // Prev-frame resolution: one hop per frame. After enough frames the chain
  // settles so A == B == C == 0.8.
  settle(m, 4);
  assert.ok(Math.abs(effAfterFrame(m, 'B') - 0.8) < 1e-9, 'B tracks C (0.8)');
  assert.ok(Math.abs(effAfterFrame(m, 'A') - 0.8) < 1e-9, 'A tracks B tracks C (0.8)');
});

// ── Leader delete clears followers (fail-safe) ─────────────────────────────
test('clearFollowersOf clears every follower of a deleted leader', () => {
  const m = makeMixer();
  addCh(m, { id: 'L', name: 'L', pattern: 'p', fader: 0.9 });
  const f1 = addCh(m, { id: 'F1', name: 'F1', pattern: 'p', fader: 0.2, followLeaderId: 'L' });
  const f2 = addCh(m, { id: 'F2', name: 'F2', pattern: 'p', fader: 0.3, followLeaderId: 'L' });
  const cleared = m.clearFollowersOf('L');
  assert.deepEqual(cleared.sort(), ['F1', 'F2'], 'both followers reported cleared');
  assert.equal(f1.followLeaderId, null);
  assert.equal(f2.followLeaderId, null);
  // After clearing, each follower reverts to its OWN manual fader (not dark).
  settle(m, 1);
  assert.ok(Math.abs(effAfterFrame(m, 'F1') - 0.2) < 1e-9, 'F1 reverts to own fader 0.2');
  assert.ok(Math.abs(effAfterFrame(m, 'F2') - 0.3) < 1e-9, 'F2 reverts to own fader 0.3');
});

test('removeMixerChannel clears followers belt-and-braces', () => {
  const m = makeMixer();
  addCh(m, { id: 'L', name: 'L', pattern: 'p', fader: 0.9 });
  const f = addCh(m, { id: 'F', name: 'F', pattern: 'p', fader: 0.4, followLeaderId: 'L' });
  m.removeMixerChannel('L');
  assert.equal(f.followLeaderId, null, 'follower cleared on leader removal');
  settle(m, 1);
  assert.ok(Math.abs(effAfterFrame(m, 'F') - 0.4) < 1e-9, 'follower reverts to own fader (still lit)');
});

test('a follower whose leader is gone (dangling) fails safe to 0, never crashes', () => {
  const m = makeMixer();
  // Manually plant a dangling reference (no leader 'GHOST' exists).
  addCh(m, { id: 'F', name: 'F', pattern: 'p', fader: 0.5, followLeaderId: 'GHOST' });
  // Must not throw, and the follower tracks the missing leader as 0.
  settle(m, 2);
  assert.equal(effAfterFrame(m, 'F'), 0, 'dangling follower reads missing leader as 0');
});

// ── Serialize round-trip + missing → defaults ──────────────────────────────
test('serializeChannel emits followLeaderId + followScale', () => {
  const c = new PatternChannel({ id: 'a', name: 'A', pattern: 'p', followLeaderId: 'L', followScale: 1.5 });
  const s = serializeChannel(c);
  assert.equal(s.followLeaderId, 'L');
  assert.equal(s.followScale, 1.5);
});

test('serializeChannel round-trips through the ctor', () => {
  const c = new PatternChannel({ id: 'a', name: 'A', pattern: 'p', followLeaderId: 'L2', followScale: 0.75 });
  const restored = new PatternChannel({ ...serializeChannel(c), pattern: c.pattern });
  assert.equal(restored.followLeaderId, 'L2');
  assert.equal(restored.followScale, 0.75);
});

test('an OLD serialized channel (no follow fields) restores to documented defaults', () => {
  const old = { id: 'a', name: 'A', pattern: 'p', mode: 'blend_screen', fader: 1, enabled: true };
  const restored = new PatternChannel(old);
  assert.equal(restored.followLeaderId, null);
  assert.equal(restored.followScale, 1.0);
});

// ── Follower still subject to its own enabled gate ─────────────────────────
test('a disabled follower contributes 0 even while following a lit leader', () => {
  const m = makeMixer();
  addCh(m, { id: 'L', name: 'L', pattern: 'p', fader: 1.0 });
  addCh(m, { id: 'F', name: 'F', pattern: 'p', fader: 1.0, enabled: false, followLeaderId: 'L' });
  settle(m, 2);
  assert.equal(effAfterFrame(m, 'F'), 0, 'disabled follower stays dark (own enabled gate wins)');
});
