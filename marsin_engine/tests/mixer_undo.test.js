// Unit tests for round-2 #10 — MIXER UNDO (docs/39 §F-undo).
//
// Two layers are unit-tested here (the fast, pure, no-WASM-boot layer);
// the route-level behaviour that needs a real WASM host + ParamCenter
// (delete→undo re-registers CPC and renders; recall→undo equals pre-recall;
// deck never dark; empty→400) is covered end-to-end in
// tests/hil/hil_mixer_undo_test.mjs — same split the snapshot/morph and
// param-preset features use.
//
//   1. UndoStack ring (lib/undo_stack.js): push/pop/depth/topLabel/isEmpty,
//      the UNDO_MAX cap dropping the OLDEST entry, and loud validation of a
//      malformed push (no silent drop — Codex P0).
//   2. captureLook DETACHMENT contract at the mixer level: a captured look is
//      plain serialized JS (no live WASM handle), and the per-channel order +
//      faders it records are a SNAPSHOT — a subsequent live reorder/fader edit
//      does NOT mutate the already-captured look. This is what lets the ring
//      hold UNDO_MAX entries cheaply and restore the PRE-mutation state.
//
// Run:  cd marsin_engine && node --test tests/mixer_undo.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { PatternMixer } from '../lib/pattern_mixer.js';
import { serializeChannel } from '../lib/state_manager.js';
import { UndoStack, UNDO_MAX } from '../lib/undo_stack.js';

// A fake WASM host (no real compile) — same stub the morph/follow tests use.
function makeFakeWasmHost() {
  return {
    renderAll6ch() {}, renderBlend6ch(h, n, bg) { return new Uint8Array(bg.length); },
    beginFrame() {}, setControl() {}, destroy() {}, getExports() { return []; },
    compile() { return { ok: true, handle: {} }; },
  };
}
function makeMixer(maxChannels = 6) {
  const m = new PatternMixer({ wasmHost: makeFakeWasmHost(), pixelCount: 2, maxChannels });
  m.wantVisThisFrame = false;
  return m;
}
function addCh(m, id, extra = {}) {
  return m.addMixerChannel({ id, name: id, pattern: 'p', handle: {}, enabled: true, fader: 1, ...extra });
}

// captureLook(), as defined in api_server.js, serializes the live mixer into
// the on-disk channel shape via state_manager.serializeChannel — the SAME
// shape buildChannelFromSaved restores from. We reproduce that shape here so
// the ring's detachment contract is asserted without an engine boot.
function captureLook(m) {
  const deck = m.getDeckChannel();
  return {
    master: m.master,
    deck: deck ? serializeChannel(deck) : null,
    channels: m.getMixerChannels().map(c => serializeChannel(c)),
    mixGroups: m.getMixGroups().map(g => ({
      id: g.id, name: g.name, fader: g.fader, muted: g.muted, color: g.color,
    })),
  };
}

// ── UndoStack ring mechanics ────────────────────────────────────────────────

test('empty ring: depth 0, topLabel null, isEmpty true, pop null', () => {
  const u = new UndoStack();
  assert.equal(u.depth, 0);
  assert.equal(u.topLabel, null);
  assert.equal(u.isEmpty, true);
  assert.equal(u.pop(), null);
});

test('push then report depth + top label', () => {
  const u = new UndoStack();
  u.push({ label: 'delete a', look: {}, atMs: 1 });
  assert.equal(u.depth, 1);
  assert.equal(u.topLabel, 'delete a');
  assert.equal(u.isEmpty, false);
  u.push({ label: 'reorder', look: {}, atMs: 2 });
  assert.equal(u.depth, 2);
  assert.equal(u.topLabel, 'reorder', 'top is the MOST RECENT push');
});

test('pop returns the most recent entry (LIFO) and shrinks depth', () => {
  const u = new UndoStack();
  u.push({ label: 'first', look: { v: 1 }, atMs: 1 });
  u.push({ label: 'second', look: { v: 2 }, atMs: 2 });
  const top = u.pop();
  assert.equal(top.label, 'second');
  assert.deepEqual(top.look, { v: 2 });
  assert.equal(u.depth, 1);
  assert.equal(u.topLabel, 'first');
});

test('ring caps at UNDO_MAX — the OLDEST entry is dropped', () => {
  const u = new UndoStack(); // default UNDO_MAX
  for (let i = 0; i < UNDO_MAX + 5; i++) {
    u.push({ label: `op ${i}`, look: { i }, atMs: i });
  }
  assert.equal(u.depth, UNDO_MAX, 'depth never exceeds the cap');
  assert.equal(u.topLabel, `op ${UNDO_MAX + 4}`, 'newest survives');
  // The oldest 5 (op 0..4) were dropped; the bottom of the ring is op 5.
  // Drain to the bottom and assert the oldest surviving label.
  let last;
  while (!u.isEmpty) last = u.pop();
  assert.equal(last.label, 'op 5', 'oldest 5 entries were dropped');
});

test('a smaller cap converges by dropping multiple oldest entries', () => {
  const u = new UndoStack(2);
  u.push({ label: 'a', look: {}, atMs: 1 });
  u.push({ label: 'b', look: {}, atMs: 2 });
  u.push({ label: 'c', look: {}, atMs: 3 });
  assert.equal(u.depth, 2);
  assert.equal(u.pop().label, 'c');
  assert.equal(u.pop().label, 'b');
  assert.equal(u.isEmpty, true, "'a' was dropped");
});

test('malformed push throws — never a silent drop (Codex P0)', () => {
  const u = new UndoStack();
  assert.throws(() => u.push(null), /entry must be an object/);
  assert.throws(() => u.push({ label: '', look: {}, atMs: 1 }), /label/);
  assert.throws(() => u.push({ label: 'x', look: null, atMs: 1 }), /look/);
  assert.throws(() => new UndoStack(0), /positive integer/);
  assert.throws(() => new UndoStack(-3), /positive integer/);
});

// ── captureLook detachment contract (mixer level, no boot) ───────────────────

test('a captured look holds NO live WASM handle (plain serialized shape)', () => {
  const m = makeMixer();
  addCh(m, 'a');
  addCh(m, 'b');
  const look = captureLook(m);
  for (const c of look.channels) {
    assert.equal('handle' in c, false, 'serialized channel must not carry a live handle');
  }
  // Round-trips as JSON (proves it's a plain detached object the ring can hold).
  assert.doesNotThrow(() => JSON.parse(JSON.stringify(look)));
});

test('a captured look is a SNAPSHOT: a later reorder does NOT mutate it', () => {
  const m = makeMixer();
  addCh(m, 'a'); addCh(m, 'b'); addCh(m, 'c');
  // Capture BEFORE the destructive reorder (what pushUndo does).
  const before = captureLook(m);
  const orderBefore = before.channels.map(c => c.id);
  assert.deepEqual(orderBefore, ['a', 'b', 'c']);
  // Destructive mutation: reverse the live stack.
  m.reorderMixerChannels(['c', 'b', 'a']);
  // The captured look is unchanged (it recorded the pre-mutation order).
  assert.deepEqual(before.channels.map(c => c.id), ['a', 'b', 'c'],
    'reorder must not retroactively mutate an already-captured look');
  // And a fresh capture reflects the new live order — proving the change took.
  const after = captureLook(m);
  assert.deepEqual(after.channels.map(c => c.id), ['c', 'b', 'a']);
});

test('a captured look is a SNAPSHOT: a later fader edit does NOT mutate it', () => {
  const m = makeMixer();
  const a = addCh(m, 'a', { fader: 0.3 });
  const before = captureLook(m);
  assert.equal(before.channels[0].fader, 0.3);
  // Non-destructive live edit (the kind undo deliberately does NOT push).
  a.fader = 0.9;
  assert.equal(before.channels[0].fader, 0.3,
    'a fader edit must not retroactively mutate an already-captured look');
});

test('captureLook records master + mixGroups for full-look restore', () => {
  const m = makeMixer();
  m.setMaster(0.55);
  const g = m.createMixGroup({ name: 'G' });
  g.fader = 0.7;
  addCh(m, 'a', { mixGroupId: g.id });
  const look = captureLook(m);
  assert.equal(look.master, 0.55);
  assert.equal(look.mixGroups.length, 1);
  assert.equal(look.mixGroups[0].id, g.id);
  assert.equal(look.mixGroups[0].fader, 0.7);
  assert.equal(look.channels[0].mixGroupId, g.id, 'member carries its group id');
});
