// Unit tests for WAVE 15 — groups + solo state plumbing: serialization
// round-trip (state_manager), group CRUD validation, and the
// removeMixerChannel solo/membership cleanup (spec §8 phantom-solo guard).
//
// Run:  cd marsin_engine && node --test tests/groups_solo_state.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { PatternChannel } from '../../lib/pattern_channel.js';
import { PatternMixer } from '../../lib/pattern_mixer.js';
import { serializeChannel, serializeMixGroup } from '../../lib/state_manager.js';

function makeFakeWasmHost() {
  return {
    renderAll6ch() {}, renderBlend6ch(h, n, bg) { return new Uint8Array(bg.length); },
    beginFrame() {}, setControl() {}, destroy() {}, getExports() { return []; },
    compile() { return { ok: true, handle: {} }; },
  };
}
function makeMixer() {
  const mixer = new PatternMixer({ wasmHost: makeFakeWasmHost(), pixelCount: 2 });
  // No `patternsDir` here, so nothing precompiles — and both the render hot
  // path and triggerMixerTransition now REFUSE a mode with no compiled
  // handle instead of substituting a host-side lerp/crossfade (codex P0).
  // Prime the steady blend + the default transition script so the fixtures
  // exercise the real code path rather than the refusal.
  mixer.blendHandles['blend_screen'] = { fake: true };
  mixer.blendHandles['trans_crossfade'] = { fake: true };
  return mixer;
}

// ── PatternChannel defaults ───────────────────────────────────────────────
test('PatternChannel defaults: mixGroupId null, soloSafe false', () => {
  const c = new PatternChannel({ id: 'a', name: 'A', pattern: 'p' });
  assert.equal(c.mixGroupId, null);
  assert.equal(c.soloSafe, false);
});

test('PatternChannel types mixGroupId/soloSafe defensively', () => {
  const c = new PatternChannel({ id: 'a', name: 'A', pattern: 'p', mixGroupId: 42, soloSafe: 1 });
  assert.equal(c.mixGroupId, null, 'non-string mixGroupId coerces to null');
  assert.equal(c.soloSafe, true, 'truthy soloSafe coerces to true');
});

// ── serializeChannel round-trip ───────────────────────────────────────────
test('serializeChannel emits mixGroupId + soloSafe', () => {
  const c = new PatternChannel({ id: 'a', name: 'A', pattern: 'p', mixGroupId: 'mg_1_x', soloSafe: true });
  const s = serializeChannel(c);
  assert.equal(s.mixGroupId, 'mg_1_x');
  assert.equal(s.soloSafe, true);
});

test('serializeChannel round-trips through the ctor (membership + safe survive)', () => {
  const c = new PatternChannel({ id: 'a', name: 'A', pattern: 'p', mixGroupId: 'mg_2_y', soloSafe: true });
  const restored = new PatternChannel({ ...serializeChannel(c), pattern: c.pattern });
  assert.equal(restored.mixGroupId, 'mg_2_y');
  assert.equal(restored.soloSafe, true);
});

test('an OLD serialized channel (no new fields) restores to documented defaults', () => {
  const old = { id: 'a', name: 'A', pattern: 'p', mode: 'blend_screen', fader: 1, enabled: true };
  const restored = new PatternChannel(old);
  assert.equal(restored.mixGroupId, null);
  assert.equal(restored.soloSafe, false);
});

// ── serializeMixGroup ──────────────────────────────────────────────────────
test('serializeMixGroup emits id/name/fader/muted/color with clamping', () => {
  const s = serializeMixGroup({ id: 'mg_1', name: 'G', fader: 1.5, muted: 1, color: '#abc' });
  assert.equal(s.id, 'mg_1');
  assert.equal(s.name, 'G');
  assert.equal(s.fader, 1.0, 'fader clamped to [0,1]');
  assert.equal(s.muted, true);
  assert.equal(s.color, '#abc');
});

test('serializeMixGroup defaults a non-finite fader to 1.0', () => {
  const s = serializeMixGroup({ id: 'mg_1', fader: NaN });
  assert.equal(s.fader, 1.0);
});

// ── Group CRUD ─────────────────────────────────────────────────────────────
test('createMixGroup mints an mg_* id with neutral defaults', () => {
  const m = makeMixer();
  const g = m.createMixGroup({ name: 'Stbd' });
  assert.match(g.id, /^mg_/);
  assert.equal(g.fader, 1.0);
  assert.equal(g.muted, false);
  assert.equal(g.name, 'Stbd');
});

test('addChannelToGroup: single membership — 400 on add to a SECOND group', () => {
  const m = makeMixer();
  m.addMixerChannel({ id: 'c1', name: 'C', pattern: 'p', handle: {}, enabled: true });
  const g1 = m.createMixGroup({});
  const g2 = m.createMixGroup({});
  assert.deepEqual(m.addChannelToGroup(g1.id, 'c1'), { ok: true });
  const r = m.addChannelToGroup(g2.id, 'c1');
  assert.equal(r.ok, false);
  assert.equal(r.status, 400);
});

test('addChannelToGroup is idempotent for the SAME group', () => {
  const m = makeMixer();
  m.addMixerChannel({ id: 'c1', name: 'C', pattern: 'p', handle: {}, enabled: true });
  const g = m.createMixGroup({});
  assert.deepEqual(m.addChannelToGroup(g.id, 'c1'), { ok: true });
  assert.deepEqual(m.addChannelToGroup(g.id, 'c1'), { ok: true }, 're-add same group is a no-op success');
});

test('addChannelToGroup: 404 on unknown group / channel', () => {
  const m = makeMixer();
  m.addMixerChannel({ id: 'c1', name: 'C', pattern: 'p', handle: {}, enabled: true });
  const g = m.createMixGroup({});
  assert.equal(m.addChannelToGroup('mg_nope', 'c1').status, 404);
  assert.equal(m.addChannelToGroup(g.id, 'c_nope').status, 404);
});

test('deleteMixGroup clears every member mixGroupId', () => {
  const m = makeMixer();
  m.addMixerChannel({ id: 'c1', name: 'C', pattern: 'p', handle: {}, enabled: true });
  m.addMixerChannel({ id: 'c2', name: 'C', pattern: 'p', handle: {}, enabled: true });
  const g = m.createMixGroup({});
  m.addChannelToGroup(g.id, 'c1');
  m.addChannelToGroup(g.id, 'c2');
  assert.ok(m.deleteMixGroup(g.id));
  assert.equal(m.getMixerChannel('c1').mixGroupId, null);
  assert.equal(m.getMixerChannel('c2').mixGroupId, null);
});

// ── Solo set + cleanup ─────────────────────────────────────────────────────
test('setSolo 404s on a non-existent channel (fail loud, no phantom solo)', () => {
  const m = makeMixer();
  const r = m.setSolo('nope');
  assert.equal(r.ok, false);
  assert.equal(r.status, 404);
  assert.equal(m.soloedChannelIds.size, 0);
});

test('removeMixerChannel deletes any solo + membership (no phantom-solo)', () => {
  const m = makeMixer();
  m.addMixerChannel({ id: 'c1', name: 'C', pattern: 'p', handle: {}, enabled: true });
  m.addMixerChannel({ id: 'c2', name: 'C', pattern: 'p', handle: {}, enabled: true });
  const g = m.createMixGroup({});
  m.addChannelToGroup(g.id, 'c1');
  m.setSolo('c1');
  assert.equal(m.soloedChannelIds.size, 1);
  m.removeMixerChannel('c1');
  assert.equal(m.soloedChannelIds.size, 0, 'removed channel dropped from solo set');
  // c2 still present, never soloed; no phantom solo darkening the rig.
  assert.equal(m.soloedChannelIds.has('c1'), false);
});

test('triggerMixerTransition clears the solo set at start', () => {
  const m = makeMixer();
  m.addMixerChannel({ id: 'c1', name: 'C', pattern: 'p', handle: {}, enabled: true, fader: 1 });
  m.addMixerChannel({ id: 'c2', name: 'C', pattern: 'p', handle: {}, enabled: true, fader: 1 });
  m.setSolo('c1');
  assert.equal(m.soloedChannelIds.size, 1);
  m.triggerMixerTransition({ targetChannelId: 'c2', durationMs: 500 });
  assert.equal(m.soloedChannelIds.size, 0, 'solo cleared when a transition begins');
});

test('clearSolo(id) 404s on a non-existent channel; clearSolo() always ok', () => {
  const m = makeMixer();
  assert.equal(m.clearSolo('nope').status, 404);
  assert.deepEqual(m.clearSolo(), { ok: true, changed: false });
});
