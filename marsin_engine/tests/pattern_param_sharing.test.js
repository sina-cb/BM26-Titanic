// Unit tests for per-pattern PARAM SHARING (operator request,
// feat/optimize_channels).
//
// Feature: a pattern's exported sliders/params are owned by the
// (playlist, pattern) pair — NOT by the single channel the operator touched.
// Changing a param on one channel running pattern P from playlist L must
// propagate to EVERY other live channel running that SAME (L, P): the deck
// base channel, every mixer overlay, AND every deck overlay. Channels on a
// different playlist, on a different pattern, or with no playlist are NOT
// touched. Channel-level things (fader/level/hue/mode) are not pattern
// exports and never reach this path.
//
// Tested without WASM: a stub wasmHost exposes per-handle exports + records
// setControl writes; we drive the REAL PatternMixer, the REAL
// ChannelParamRouter, and the REAL exported pure propagation core
// (propagatePatternParamWith).
//
// Run:  cd marsin_engine && node --test tests/pattern_param_sharing.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { PatternMixer } from '../lib/pattern_mixer.js';
import { ChannelParamRouter } from '../lib/channel_param_router.js';
import { propagatePatternParamWith } from '../lib/api_server.js';

// ── Stub wasmHost ───────────────────────────────────────────────────────
// Each handle is a small object { exports: [...] }. getExports(handle)
// returns that handle's export list; setControl records (handle, id, v0..2).
// kind 1 = slider (a local, propagatable control).
function makeWasmHostStub() {
  const writes = [];
  return {
    writes,
    getExports(handle) {
      return (handle && handle.exports) ? handle.exports : [];
    },
    setControl(handle, id, v0, v1, v2) {
      writes.push({ handle, id, v0, v1, v2 });
    },
    destroy() {},
    beginFrame() {},
  };
}

// Build a handle whose single slider export is named `brightness` with the
// given numeric id (ids deliberately DIFFER per handle to prove name-mapping).
function sliderHandle(tag, exportId) {
  return { tag, exports: [{ id: exportId, name: 'brightness', kind: 1 }] };
}

function makeMixer(wasmHost) {
  return new PatternMixer({ wasmHost, pixelCount: 4, maxChannels: 4 });
}

// Assign a {name, activeEntryId, pattern} playlist context to a channel.
function assign(channel, playlistName, pattern) {
  channel.playlist = { name: playlistName, activeEntryId: 'e1', cursor: 0 };
  channel.pattern = pattern;
}

// Convenience: run the propagation core for a write that already landed on
// `sourceId`, returning the ids that received the propagated value.
function propagate(mixer, wasmHost, paramRouter, sourceId, controlId, v0) {
  const source = mixer.getChannel(sourceId) || mixer.getDeckOverlay(sourceId);
  return propagatePatternParamWith({
    source, sourceChannelId: sourceId, controlId, v0, v1: 0, v2: 0,
    mixer, wasmHost, paramRouter,
  });
}

// ── mixer.channelsRunningPattern keying ──────────────────────────────────

test('channelsRunningPattern matches only same playlist AND same pattern', () => {
  const wasmHost = makeWasmHostStub();
  const m = makeMixer(wasmHost);
  m.setDeckChannel({ id: 'deck', pattern: 'rainbow', handle: sliderHandle('deck', 10) });
  assign(m.getDeckChannel(), 'default', 'rainbow');

  const o1 = m.addMixerChannel({ id: 'o1', pattern: 'rainbow', handle: sliderHandle('o1', 20) });
  assign(o1, 'default', 'rainbow');                 // same (L,P) — match
  const o2 = m.addMixerChannel({ id: 'o2', pattern: 'rainbow', handle: sliderHandle('o2', 30) });
  assign(o2, 'fast', 'rainbow');                    // different playlist — no match
  const o3 = m.addMixerChannel({ id: 'o3', pattern: 'sparkle', handle: sliderHandle('o3', 40) });
  assign(o3, 'default', 'sparkle');                 // different pattern — no match

  const matches = m.channelsRunningPattern('default', 'rainbow', { excludeId: 'deck' });
  const ids = matches.map(c => c.id).sort();
  assert.deepEqual(ids, ['o1'], 'only the same-(playlist,pattern) overlay matches; source excluded');
});

test('channelsRunningPattern excludes channels with no playlist assignment', () => {
  const wasmHost = makeWasmHostStub();
  const m = makeMixer(wasmHost);
  m.setDeckChannel({ id: 'deck', pattern: 'rainbow', handle: sliderHandle('deck', 10) });
  assign(m.getDeckChannel(), 'default', 'rainbow');
  const o1 = m.addMixerChannel({ id: 'o1', pattern: 'rainbow', handle: sliderHandle('o1', 20) });
  o1.playlist = null; // never assigned a playlist
  o1.pattern = 'rainbow';

  const matches = m.channelsRunningPattern('default', 'rainbow', { excludeId: 'deck' });
  assert.deepEqual(matches.map(c => c.id), [], 'a channel with no playlist is never a match');
});

test('getAllLiveChannels spans deck base + mixer overlays + deck overlays', () => {
  const wasmHost = makeWasmHostStub();
  const m = makeMixer(wasmHost);
  m.setDeckChannel({ id: 'deck', pattern: 'p', handle: sliderHandle('deck', 1) });
  m.addMixerChannel({ id: 'mo', pattern: 'p', handle: sliderHandle('mo', 2) });
  m.addDeckOverlay({ id: 'do', pattern: 'p', handle: sliderHandle('do', 3), viewSelection: { type: 'group', target: 'Bow', invert: false } });
  const ids = m.getAllLiveChannels().map(c => c.id).sort();
  assert.deepEqual(ids, ['deck', 'do', 'mo']);
});

// ── propagation: the core operator request ───────────────────────────────

test('changing a param on one channel propagates to siblings on the SAME (playlist,pattern)', () => {
  const wasmHost = makeWasmHostStub();
  const m = makeMixer(wasmHost);
  const paramRouter = new ChannelParamRouter(m, null);

  // Deck base + a mixer overlay + a deck overlay, all running rainbow@default.
  m.setDeckChannel({ id: 'deck', pattern: 'rainbow', handle: sliderHandle('deck', 11) });
  assign(m.getDeckChannel(), 'default', 'rainbow');
  const mo = m.addMixerChannel({ id: 'mo', pattern: 'rainbow', handle: sliderHandle('mo', 22) });
  assign(mo, 'default', 'rainbow');
  const dov = m.addDeckOverlay({ id: 'dov', pattern: 'rainbow', handle: sliderHandle('dov', 33), viewSelection: { type: 'group', target: 'Bow', invert: false } });
  assign(dov, 'default', 'rainbow');

  // Operator turns the deck's `brightness` slider (controlId 11 on the deck
  // handle) to 200. That write itself is done by the route via paramRouter;
  // here we simulate it then propagate.
  paramRouter.setChannelControl('deck', 11, 200, 0, 0);
  const applied = propagate(m, wasmHost, paramRouter, 'deck', 11, 200);

  assert.deepEqual(applied.sort(), ['dov', 'mo'], 'both siblings receive the value');
  // Each sibling's localControls now holds 200 under ITS OWN export id.
  assert.equal(mo.localControls[22].v0, 200, 'mixer overlay updated (by name, distinct id)');
  assert.equal(dov.localControls[33].v0, 200, 'deck overlay updated (by name, distinct id)');
  // And the WASM handles were written through.
  assert.ok(wasmHost.writes.some(w => w.handle.tag === 'mo' && w.id === 22 && w.v0 === 200));
  assert.ok(wasmHost.writes.some(w => w.handle.tag === 'dov' && w.id === 33 && w.v0 === 200));
});

test('a channel on a DIFFERENT playlist or pattern is NOT changed', () => {
  const wasmHost = makeWasmHostStub();
  const m = makeMixer(wasmHost);
  const paramRouter = new ChannelParamRouter(m, null);

  m.setDeckChannel({ id: 'deck', pattern: 'rainbow', handle: sliderHandle('deck', 11) });
  assign(m.getDeckChannel(), 'default', 'rainbow');
  const sameLP = m.addMixerChannel({ id: 'same', pattern: 'rainbow', handle: sliderHandle('same', 22) });
  assign(sameLP, 'default', 'rainbow');
  const otherPlaylist = m.addMixerChannel({ id: 'otherL', pattern: 'rainbow', handle: sliderHandle('otherL', 44) });
  assign(otherPlaylist, 'fast', 'rainbow');         // same pattern, DIFFERENT playlist
  const otherPattern = m.addMixerChannel({ id: 'otherP', pattern: 'sparkle', handle: { tag: 'otherP', exports: [{ id: 55, name: 'brightness', kind: 1 }] } });
  assign(otherPattern, 'default', 'sparkle');       // same playlist, DIFFERENT pattern

  paramRouter.setChannelControl('deck', 11, 200, 0, 0);
  const applied = propagate(m, wasmHost, paramRouter, 'deck', 11, 200);

  assert.deepEqual(applied, ['same'], 'only the same-(L,P) channel is updated');
  assert.equal(otherPlaylist.localControls[44], undefined, 'different playlist untouched');
  assert.equal(otherPattern.localControls[55], undefined, 'different pattern untouched');
});

test('propagation never writes back to the SOURCE channel', () => {
  const wasmHost = makeWasmHostStub();
  const m = makeMixer(wasmHost);
  const paramRouter = new ChannelParamRouter(m, null);
  m.setDeckChannel({ id: 'deck', pattern: 'rainbow', handle: sliderHandle('deck', 11) });
  assign(m.getDeckChannel(), 'default', 'rainbow');
  const mo = m.addMixerChannel({ id: 'mo', pattern: 'rainbow', handle: sliderHandle('mo', 22) });
  assign(mo, 'default', 'rainbow');

  const applied = propagate(m, wasmHost, paramRouter, 'deck', 11, 150);
  assert.ok(!applied.includes('deck'), 'source id is never in the applied set');
});

test('CPC-owned exports are NOT propagated (paramRouter rejects shared controls)', () => {
  const wasmHost = makeWasmHostStub();
  const m = makeMixer(wasmHost);
  // Stub paramCenter that flags export id 22 on channel `mo` as CPC-owned.
  const paramCenter = {
    isSharedControlId: (channelId, controlId) => channelId === 'mo' && controlId === 22,
    getBlockedIds: () => new Set(),
    isSharedExport: () => false,
  };
  const paramRouter = new ChannelParamRouter(m, paramCenter);

  m.setDeckChannel({ id: 'deck', pattern: 'rainbow', handle: sliderHandle('deck', 11) });
  assign(m.getDeckChannel(), 'default', 'rainbow');
  const mo = m.addMixerChannel({ id: 'mo', pattern: 'rainbow', handle: sliderHandle('mo', 22) });
  assign(mo, 'default', 'rainbow');

  const applied = propagate(m, wasmHost, paramRouter, 'deck', 11, 200);
  assert.deepEqual(applied, [], 'CPC-owned target control is skipped (shared ownership wins)');
  assert.equal(mo.localControls[22], undefined, 'CPC-owned control not overwritten by propagation');
});

test('no (playlist,pattern) context on the source ⇒ no propagation', () => {
  const wasmHost = makeWasmHostStub();
  const m = makeMixer(wasmHost);
  const paramRouter = new ChannelParamRouter(m, null);
  m.setDeckChannel({ id: 'deck', pattern: 'rainbow', handle: sliderHandle('deck', 11) });
  m.getDeckChannel().playlist = null; // no playlist on the source
  const mo = m.addMixerChannel({ id: 'mo', pattern: 'rainbow', handle: sliderHandle('mo', 22) });
  assign(mo, 'default', 'rainbow');

  const applied = propagate(m, wasmHost, paramRouter, 'deck', 11, 200);
  assert.deepEqual(applied, [], 'a source with no playlist shares nothing');
});
