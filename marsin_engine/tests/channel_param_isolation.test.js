// Mixer channel PARAMETER ISOLATION (operator ruling — Sina, 2026-07-07).
//
// This file REPLACES tests/pattern_param_sharing.test.js, which pinned the
// now-reversed behavior: the old "per-pattern param SHARING" feature
// (feat/optimize_channels) mirrored a param write on one channel onto every
// other live channel running the same (playlist, pattern), and a debounced
// auto-capture wrote every live tweak back into the playlist entry's
// `defaults` on disk. The bug that reversed it: with the SAME playlist loaded
// on two mixer channels, changing a parameter on one channel changed the
// pattern on the other.
//
// The three requirements pinned here:
//   1. Loading/tweaking NEVER writes parameter state into a playlist file —
//      playlist files are shared presets. Entry `defaults` change only via
//      the EXPLICIT capture routes (POST /deck/playlist/capture,
//      POST /mixer/channels/:id/playlist/capture).
//   2. Parameters are CHANNEL-LOCAL: each channel keeps its own live values
//      (own WASM handle + own `localControls`) for its active pattern.
//   3. Same playlist on two channels: a param write on channel A must not
//      touch channel B — not its localControls, not its WASM handle, and not
//      the on-disk entry defaults a later entry switch would replay.
//
// Tested without WASM: a stub wasmHost exposes per-handle exports + records
// setControl writes; we drive the REAL PatternMixer, the REAL
// ChannelParamRouter, and the REAL PlaylistManager (temp playlist dir).
//
// Run:  cd marsin_engine && node --test tests/channel_param_isolation.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { PatternMixer } from '../lib/pattern_mixer.js';
import { ChannelParamRouter } from '../lib/channel_param_router.js';
import { PlaylistManager } from '../lib/playlist_manager.js';
import * as apiServer from '../lib/api_server.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const API_SERVER_SRC = fs.readFileSync(
  path.join(__dirname, '..', 'lib', 'api_server.js'), 'utf8');

// ── Stub wasmHost ───────────────────────────────────────────────────────
// Each handle is a small object { exports: [...] }. getExports(handle)
// returns that handle's export list; setControl records (handle, id, v0..2).
// kind 1 = slider (a local control).
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

// Build a handle whose single slider export is named `speed` with the given
// numeric id (ids deliberately DIFFER per handle to mirror real compiles).
function sliderHandle(tag, exportId) {
  return { tag, exports: [{ id: exportId, name: 'speed', kind: 1 }] };
}

function makeMixer(wasmHost) {
  return new PatternMixer({ wasmHost, pixelCount: 4, maxChannels: 4 });
}

// Assign a {name, activeEntryId, pattern} playlist context to a channel.
function assign(channel, playlistName, pattern, entryId = 'e1') {
  channel.playlist = { name: playlistName, activeEntryId: entryId, cursor: 0 };
  channel.pattern = pattern;
}

// Fresh temp playlist library containing one playlist with one entry whose
// saved default is speed=0.7. patternsDir points at the REAL patterns dir so
// patternExists() resolves (we use `rainbow`, a real shipped pattern).
function makeTempPlaylist() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'marsin_pl_iso_'));
  const patternsDir = path.join(__dirname, '..', 'patterns');
  const pm = new PlaylistManager(dir, patternsDir);
  pm.save({
    name: 'party',
    entries: [{ id: 'e1', pattern: 'rainbow', label: null, defaults: { speed: 0.7 }, notes: null }],
  });
  const file = path.join(dir, 'party.yaml');
  return { dir, pm, file };
}

// ── REQ 3: THE BUG — two channels, same playlist, no bleed ──────────────

test('REQ3 bleed: same playlist on two channels — a param write on A never touches B', () => {
  const wasmHost = makeWasmHostStub();
  const m = makeMixer(wasmHost);
  const paramRouter = new ChannelParamRouter(m, null);

  // Deck base + two mixer overlays + a deck overlay, ALL running the same
  // pattern from the same playlist — the exact repro Sina reported.
  m.setDeckChannel({ id: 'deck', pattern: 'rainbow', handle: sliderHandle('deck', 11) });
  assign(m.getDeckChannel(), 'party', 'rainbow');
  const a = m.addMixerChannel({ id: 'a', pattern: 'rainbow', handle: sliderHandle('a', 22) });
  assign(a, 'party', 'rainbow');
  const b = m.addMixerChannel({ id: 'b', pattern: 'rainbow', handle: sliderHandle('b', 33) });
  assign(b, 'party', 'rainbow');
  const dov = m.addDeckOverlay({ id: 'dov', pattern: 'rainbow', handle: sliderHandle('dov', 44), viewSelection: { type: 'group', target: 'Bow', invert: false } });
  assign(dov, 'party', 'rainbow');

  // Operator turns channel A's `speed` slider. This is the same call the
  // /mixer/channels/:id/control route and the WS setChannelControl path make
  // — and since the propagation core is gone, it is the ONLY write.
  const r = paramRouter.setChannelControl('a', 22, 0.2, 0, 0);
  assert.equal(r.status, 'ok');

  // A holds its own value…
  assert.equal(a.localControls[22].v0, 0.2, 'source channel updated');
  // …and NOBODY else was touched: no localControls, no WASM writes.
  assert.equal(Object.keys(b.localControls).length, 0, 'sibling mixer channel untouched');
  assert.equal(Object.keys(m.getDeckChannel().localControls).length, 0, 'deck untouched');
  assert.equal(Object.keys(dov.localControls).length, 0, 'deck overlay untouched');
  const foreignWrites = wasmHost.writes.filter(w => w.handle.tag !== 'a');
  assert.deepEqual(foreignWrites, [], 'no WASM write ever lands on another channel\'s handle');
});

test('REQ3 guard: the param-propagation machinery is gone from the engine', () => {
  // The pure propagation core is no longer exported from api_server…
  assert.equal(apiServer.propagatePatternParamWith, undefined,
    'propagatePatternParamWith must not be exported (feature reversed by operator ruling)');
  // …the (playlist, pattern) sibling query it keyed on is gone from the
  // mixer…
  const m = makeMixer(makeWasmHostStub());
  assert.equal(m.channelsRunningPattern, undefined,
    'channelsRunningPattern must be removed with the sharing feature');
  // …and no route wires a control write into a propagate-and-capture helper.
  assert.ok(!API_SERVER_SRC.includes('propagateAndCapturePatternParam'),
    'api_server.js must not contain propagateAndCapturePatternParam');
});

// ── REQ 2: channel-local live values ─────────────────────────────────────

test('REQ2: each channel keeps its own live value for the same export of the same pattern', () => {
  const wasmHost = makeWasmHostStub();
  const m = makeMixer(wasmHost);
  const paramRouter = new ChannelParamRouter(m, null);
  m.setDeckChannel({ id: 'deck', pattern: 'rainbow', handle: sliderHandle('deck', 11) });
  assign(m.getDeckChannel(), 'party', 'rainbow');
  const a = m.addMixerChannel({ id: 'a', pattern: 'rainbow', handle: sliderHandle('a', 22) });
  assign(a, 'party', 'rainbow');
  const b = m.addMixerChannel({ id: 'b', pattern: 'rainbow', handle: sliderHandle('b', 33) });
  assign(b, 'party', 'rainbow');

  paramRouter.setChannelControl('a', 22, 0.2, 0, 0);
  paramRouter.setChannelControl('b', 33, 0.9, 0, 0);
  paramRouter.setChannelControl('a', 22, 0.4, 0, 0); // A tweaks again

  assert.equal(a.localControls[22].v0, 0.4, 'A holds its latest value');
  assert.equal(b.localControls[33].v0, 0.9, 'B holds ITS value — A\'s re-tweak did not move it');
  // Every WASM write landed on the writing channel's own handle.
  for (const w of wasmHost.writes) {
    const expected = { a: 22, b: 33 }[w.handle.tag];
    assert.equal(w.id, expected, `write to handle '${w.handle.tag}' used its own export id`);
  }
});

// ── REQ 1: loading + tweaking never rewrites the playlist file ────────────

test('REQ1: a load + tweak session leaves the playlist file byte-identical on disk', () => {
  const { pm, file } = makeTempPlaylist();
  const before = fs.readFileSync(file);

  const wasmHost = makeWasmHostStub();
  const m = makeMixer(wasmHost);
  const paramRouter = new ChannelParamRouter(m, null);
  m.setDeckChannel({ id: 'deck', pattern: 'rainbow', handle: sliderHandle('deck', 11) });
  const a = m.addMixerChannel({ id: 'a', pattern: 'rainbow', handle: sliderHandle('a', 22) });
  const b = m.addMixerChannel({ id: 'b', pattern: 'rainbow', handle: sliderHandle('b', 33) });

  // "Load" the same playlist entry onto BOTH channels exactly as
  // loadPlaylistEntry does: read entry, replay entry defaults through the
  // router.
  const pl = pm.load('party');
  const entry = pl.entries[0];
  for (const ch of [a, b]) {
    assign(ch, 'party', 'rainbow');
    pm.applyEntryDefaults(ch, entry, wasmHost, paramRouter, null);
  }
  assert.equal(a.localControls[22].v0, 0.7, 'A loaded the saved default');
  assert.equal(b.localControls[33].v0, 0.7, 'B loaded the saved default');

  // Tweak session on both channels (this used to schedule the debounced
  // auto-capture that rewrote the file 500 ms later).
  paramRouter.setChannelControl('a', 22, 0.2, 0, 0);
  paramRouter.setChannelControl('b', 33, 0.9, 0, 0);
  paramRouter.setChannelControl('a', 22, 0.4, 0, 0);

  const after = fs.readFileSync(file);
  assert.ok(before.equals(after), 'playlist file must be byte-identical after load + tweaks');
});

test('REQ1 guard (source): no control-write path auto-captures; explicit capture routes remain', () => {
  // The debounced auto-capture is gone…
  assert.ok(!API_SERVER_SRC.includes('scheduleEntryCapture'),
    'api_server.js must not contain scheduleEntryCapture (implicit playlist writeback)');
  assert.ok(!API_SERVER_SRC.includes('CAPTURE_DEBOUNCE_MS'),
    'api_server.js must not contain the capture debounce timer');
  // …but the EXPLICIT operator save-defaults action is preserved: the two
  // capture routes and the function they call must still exist.
  assert.ok(API_SERVER_SRC.includes("'/deck/playlist/capture'"),
    'explicit deck capture route must remain');
  assert.ok(API_SERVER_SRC.includes('\\/playlist\\/capture$'),
    'explicit per-channel mixer capture route must remain');
  assert.ok(API_SERVER_SRC.includes('function captureActiveEntryDefaults'),
    'captureActiveEntryDefaults (explicit capture) must remain');
});

// ── Entry switch: B replays the ON-DISK defaults, never A's live tweaks ──

test('entry (re)load replays pristine on-disk defaults — a sibling\'s live tweaks never clobber', () => {
  const { pm } = makeTempPlaylist();
  const wasmHost = makeWasmHostStub();
  const m = makeMixer(wasmHost);
  const paramRouter = new ChannelParamRouter(m, null);
  m.setDeckChannel({ id: 'deck', pattern: 'rainbow', handle: sliderHandle('deck', 11) });
  const a = m.addMixerChannel({ id: 'a', pattern: 'rainbow', handle: sliderHandle('a', 22) });
  assign(a, 'party', 'rainbow');
  const b = m.addMixerChannel({ id: 'b', pattern: 'rainbow', handle: sliderHandle('b', 33) });

  // A loads the entry and tweaks hard.
  pm.applyEntryDefaults(a, pm.load('party').entries[0], wasmHost, paramRouter, null);
  paramRouter.setChannelControl('a', 22, 0.05, 0, 0);

  // B now switches to that same entry (fresh load from disk, as
  // loadPlaylistEntry does: clear localControls, re-read, apply).
  assign(b, 'party', 'rainbow');
  b.localControls = {};
  const freshEntry = pm.load('party').entries[0];
  pm.applyEntryDefaults(b, freshEntry, wasmHost, paramRouter, null);

  assert.equal(b.localControls[33].v0, 0.7,
    'B gets the SAVED default (0.7), not A\'s live tweak (0.05)');
  assert.equal(a.localControls[22].v0, 0.05, 'A keeps its live tweak');
});

// ── Explicit save-defaults still works end-to-end at the manager level ───

test('EXPLICIT capture persists a channel\'s live values into the entry defaults (reads stay)', () => {
  const { pm, file } = makeTempPlaylist();
  const wasmHost = makeWasmHostStub();
  const m = makeMixer(wasmHost);
  const paramRouter = new ChannelParamRouter(m, null);
  m.setDeckChannel({ id: 'deck', pattern: 'rainbow', handle: sliderHandle('deck', 11) });
  const a = m.addMixerChannel({ id: 'a', pattern: 'rainbow', handle: sliderHandle('a', 22) });
  assign(a, 'party', 'rainbow');

  paramRouter.setChannelControl('a', 22, 0.33, 0, 0);

  // This is what POST /mixer/channels/:id/playlist/capture does:
  const pl = pm.load('party');
  const entry = pl.entries.find(e => e.id === 'e1');
  entry.defaults = pm.captureDefaults(a, wasmHost, null);
  pm.save(pl);

  const reread = pm.load('party').entries[0];
  assert.equal(reread.defaults.speed, 0.33, 'explicit capture wrote the live value to disk');
  assert.ok(fs.readFileSync(file).toString().includes('0.33'), 'value persisted in the YAML');
});
