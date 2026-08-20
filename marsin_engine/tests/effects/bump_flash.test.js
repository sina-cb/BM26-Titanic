// Unit tests for round-2 #5 — FLASH / BUMP (momentary full-while-held).
//
// Semantics (docs/39 §10.7), enforced through PatternMixer._effFader driven by
// renderAll6ch:
//   - A channel in `_bumpedChannelIds` is OVERRIDDEN to FULL — overriding its
//     own fader, its group scale, AND the solo-dimming gate so the accent
//     always reads.
//   - BUT the per-fixture faderMax safety ceiling STILL holds: a bumped
//     channel goes to min(1.0, faderMax) so a CAP-protected fixture is never
//     over-driven.
//   - A hard mute (enabled=false) STILL wins: a muted channel never bumps.
//   - Bump is TRANSIENT: cleared on transition / channel removal / teardown.
//   - The hot path stays allocation-free + O(1) gated.
//
// The fake WASM host's renderBlend6ch is a fader-weighted lerp(bg, fg), so a
// single white overlay over black paints round(255 * effFader) into pixel 0,
// letting us assert the composite numerically (same harness as the groups/solo
// precedence suite).
//
// Run:  cd marsin_engine && node --test tests/bump_flash.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { PatternMixer } from '../../lib/pattern_mixer.js';

function makeFakeWasmHost() {
  return {
    renderAll6ch(handle, buffer) {
      if (typeof handle?.fillFn === 'function') handle.fillFn(buffer);
    },
    renderBlend6ch(blendHandle, n, bg, fg, fader) {
      const out = new Uint8Array(bg.length);
      for (let i = 0; i < bg.length; i++) {
        out[i] = Math.round(bg[i] + (fg[i] - bg[i]) * fader);
      }
      return out;
    },
    beginFrame() {}, setControl() {}, destroy() {},
    getExports() { return []; },
    compile() { return { ok: true, handle: { fillFn: () => {} } }; },
  };
}

function whitePainter() {
  return { fillFn: (buf) => { for (let i = 0; i < buf.length; i++) buf[i] = 255; } };
}

function makeMixer(overlayConfigs) {
  const wasmHost = makeFakeWasmHost();
  const mixer = new PatternMixer({ wasmHost, pixelCount: 2 });
  mixer.blendHandles['blend_screen'] = { fake: true };
  // triggerMixerTransition now requires a compiled handle for its transition
  // script and refuses (returns null) without one — no silent crossfade
  // substitution. Nothing precompiles here (no `patternsDir`), so prime the
  // default trans_crossfade too or the re-cue never runs.
  mixer.blendHandles['trans_crossfade'] = { fake: true };
  mixer.wantVisThisFrame = false;
  mixer.viewFader = 1.0;
  mixer.targetViewFader = 1.0;
  for (const cfg of overlayConfigs) {
    mixer.addMixerChannel({
      name: 'White', pattern: 'white', handle: whitePainter(),
      mode: 'blend_screen', fader: 1.0, enabled: true, ...cfg,
    });
  }
  return mixer;
}

function red0(mixer) { return mixer.renderAll6ch()[0]; }

// ── Core override behavior ──────────────────────────────────────────────

test('bump overrides a low fader to FULL', () => {
  const m = makeMixer([{ id: 'a', fader: 0.25 }]);
  assert.equal(red0(m), 64, 'baseline: 0.25 fader → ~64');
  const r = m.bumpChannel('a');
  assert.ok(r.ok && r.changed);
  assert.equal(red0(m), 255, 'bumped channel slams to full regardless of its parked fader');
});

test('release snaps back to the parked level (fader untouched)', () => {
  const m = makeMixer([{ id: 'a', fader: 0.25 }]);
  m.bumpChannel('a');
  assert.equal(red0(m), 255);
  m.unbumpChannel('a');
  assert.equal(red0(m), 64, 'release returns to the parked 0.25 — bump never mutated the fader');
  assert.equal(m.getMixerChannel('a').fader, 0.25, 'parked fader is sacred');
});

test('bump respects the faderMax safety ceiling (min(1.0, faderMax))', () => {
  const m = makeMixer([{ id: 'a', fader: 0.1, faderMax: 0.5 }]);
  m.bumpChannel('a');
  // CAP-protected fixture: bump goes to faderMax (0.5), NOT 1.0.
  assert.equal(red0(m), 128, 'bump is capped by faderMax — a CAP fixture is never over-driven');
});

test('bump overrides a muting group scale (accent reads through a dimmed group)', () => {
  const m = makeMixer([{ id: 'a', fader: 1.0 }]);
  const g = m.createMixGroup({});
  m.addChannelToGroup(g.id, 'a');
  g.fader = 0.25;
  assert.equal(red0(m), 64, 'group scales the member down to 0.25');
  m.bumpChannel('a');
  assert.equal(red0(m), 255, 'bump overrides the group scale → full');
});

test('bump overrides the solo-dimming gate (a non-soloed channel still bumps full)', () => {
  const m = makeMixer([{ id: 'a', fader: 1.0 }, { id: 'b', fader: 1.0 }]);
  m.setSolo('b'); // a is gated dark by b's solo
  // a alone (it's the bottom overlay) — assert via a-only mixer to isolate.
  const m2 = makeMixer([{ id: 'a', fader: 1.0 }, { id: 'b', fader: 0.0 }]);
  m2.setSolo('b');
  assert.equal(red0(m2), 0, 'a is gated dark by b solo, b contributes 0');
  m2.bumpChannel('a');
  assert.equal(red0(m2), 255, 'bumped a punches through the solo gate to full');
});

// ── Mute still wins ─────────────────────────────────────────────────────

test('hard mute (enabled=false) WINS over bump — a muted channel does not bump', () => {
  const m = makeMixer([{ id: 'a', fader: 1.0, enabled: false }]);
  m.bumpChannel('a');
  assert.equal(red0(m), 0, 'a muted channel stays dark even when bumped (mute is explicit off)');
});

// ── Method contracts + fail-loud ────────────────────────────────────────

test('bumpChannel returns changed flag (idempotent re-bump)', () => {
  const m = makeMixer([{ id: 'a', fader: 1.0 }]);
  assert.deepEqual(m.bumpChannel('a'), { ok: true, changed: true });
  assert.deepEqual(m.bumpChannel('a'), { ok: true, changed: false }, 're-bump is a no-op renew');
});

test('bumpChannel on an unknown id is a fail-loud 404 (no silent fallback)', () => {
  const m = makeMixer([{ id: 'a', fader: 1.0 }]);
  const r = m.bumpChannel('nope');
  assert.equal(r.ok, false);
  assert.equal(r.status, 404);
  assert.match(r.error, /not found/);
  assert.equal(m._bumpedChannelIds.size, 0, 'a rejected bump never enters the set');
});

test('unbumpChannel(id) on an unknown id is a fail-loud 404', () => {
  const m = makeMixer([{ id: 'a', fader: 1.0 }]);
  const r = m.unbumpChannel('nope');
  assert.equal(r.ok, false);
  assert.equal(r.status, 404);
});

test('unbumpChannel() with no arg releases ALL bumps', () => {
  const m = makeMixer([{ id: 'a', fader: 1.0 }, { id: 'b', fader: 1.0 }]);
  m.bumpChannel('a');
  m.bumpChannel('b');
  assert.equal(m._bumpedChannelIds.size, 2);
  const r = m.unbumpChannel();
  assert.ok(r.ok && r.changed);
  assert.equal(m._bumpedChannelIds.size, 0, 'release-all empties the set');
});

test('clearBumps empties the set and reports whether it changed', () => {
  const m = makeMixer([{ id: 'a', fader: 1.0 }]);
  assert.equal(m.clearBumps(), false, 'no-op clear reports false');
  m.bumpChannel('a');
  assert.equal(m.clearBumps(), true);
  assert.equal(m._bumpedChannelIds.size, 0);
});

// ── Transient lifecycle: cleared on transition / removal / teardown ──────

test('removing a channel drops its bump (no phantom bump)', () => {
  const m = makeMixer([{ id: 'a', fader: 1.0 }, { id: 'b', fader: 1.0 }]);
  m.bumpChannel('a');
  assert.ok(m._bumpedChannelIds.has('a'));
  m.removeMixerChannel('a');
  assert.equal(m._bumpedChannelIds.has('a'), false, 'removed channel id is purged from the bump set');
});

test('a scripted mixer transition clears bumps (re-cue starts clean)', () => {
  const m = makeMixer([{ id: 'a', fader: 1.0 }, { id: 'b', fader: 1.0 }]);
  m.bumpChannel('a');
  assert.equal(m._bumpedChannelIds.size, 1);
  m.triggerMixerTransition({ targetChannelId: 'b', durationMs: 0 });
  assert.equal(m._bumpedChannelIds.size, 0, 'a re-cue drops the transient bump');
});

test('panicToSafeDefault clears bumps', () => {
  const m = makeMixer([{ id: 'a', fader: 1.0 }]);
  m.bumpChannel('a');
  m.panicToSafeDefault();
  assert.equal(m._bumpedChannelIds.size, 0, 'panic recovery drops any held bump');
});

// ── Hot path: allocation-free + gated ────────────────────────────────────

test('the bump set is a reused Set (never reallocated across renders)', () => {
  const m = makeMixer([{ id: 'a', fader: 1.0 }]);
  const ref = m._bumpedChannelIds;
  m.bumpChannel('a');
  m.renderAll6ch();
  m.unbumpChannel('a');
  m.renderAll6ch();
  assert.equal(m._bumpedChannelIds, ref, 'the bump Set object identity is stable (mutated in place)');
});

test('_effFader bump branch is gated: no bumps → the override is skipped', () => {
  const m = makeMixer([{ id: 'a', fader: 0.5 }]);
  // With an empty bump set, _effFader must take the normal fader path.
  assert.equal(m._bumpedChannelIds.size, 0);
  assert.equal(m._effFader(m.getMixerChannel('a'), false), 0.5, 'no-bump path returns the clamped fader');
  m.bumpChannel('a');
  assert.equal(m._effFader(m.getMixerChannel('a'), false), 1.0, 'bumped → full');
});
