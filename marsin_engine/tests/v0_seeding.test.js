// v0-seeding tests (engine side) — root fix for docs/34 §#1 MIDI knob off-by-k.
//
// The bug: `serializeChannel` only attaches `v0` to a local-control export
// when `channel.localControls[id]` exists. A freshly-loaded pattern whose
// slider was never touched (and has no saved playlist default) therefore
// broadcasts NO v0, and CaptainPad's hook DROPS it from the knob-mapped list
// (useMidiControl.ts:488) — throwing every MFT knob index off-by-k.
//
// The fix: PatternChannel.seedLocalControlDefaults() seeds every untouched
// local-control export with its Pixelblaze default and APPLIES it to the VM,
// so the serializer always has a real v0 to broadcast.
//
// Run:  node --test tests/v0_seeding.test.js
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

import { WasmHost } from '../lib/wasm_host.js';
import { PatternChannel } from '../lib/pattern_channel.js';
import { PlaylistManager } from '../lib/playlist_manager.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PATTERNS_DIR = path.resolve(__dirname, '../patterns');

const LOCAL_CONTROL_KINDS = new Set([1, 2, 3, 6]);

// Mirror of the api_server `serializeChannel` export projection — the exact
// filter/map that produces the payload CaptainPad consumes. If seeding works,
// every kind-1 slider row here carries a numeric v0.
function serializeExports(channel, wasmHost) {
  return wasmHost.getExports(channel.handle)
    .filter(e => LOCAL_CONTROL_KINDS.has(e.kind))
    .map(e => {
      const cv = channel.localControls[e.id];
      if (cv) { e.v0 = cv.v0; e.v1 = cv.v1; e.v2 = cv.v2; }
      return e;
    });
}

let host;

before(async () => {
  host = new WasmHost();
  await host.init(64);
});

// Load a real pattern with sliders onto a channel, exactly as the engine does:
// reset localControls → beginFrame(0) top-level scope → (fix) seed defaults.
// The `seed` flag lets the RED test exercise the pre-fix behavior (no seeding).
function loadChannel(patternFile, { seed }) {
  const src = fs.readFileSync(path.join(PATTERNS_DIR, patternFile), 'utf8');
  const comp = host.compile(src);
  assert.ok(comp.ok, `compile failed: ${comp.error}`);
  const channel = new PatternChannel({ id: 'ch_test', name: 'test', pattern: patternFile, handle: comp.handle });
  channel.localControls = {};
  host.beginFrame(channel.handle, 0);
  if (seed) channel.seedLocalControlDefaults(host);
  return channel;
}

test('RED baseline: WITHOUT seeding an untouched slider has no v0 (the bug)', () => {
  const ch = loadChannel('01_cylon_sweep.js', { seed: false });
  const exps = serializeExports(ch, host);
  const sliders = exps.filter(e => e.kind === 1);
  assert.ok(sliders.length > 0, 'pattern must declare at least one slider');
  // This is the broken state the fix eliminates: v0 is absent, so the client
  // drops the row and MIDI knob indices shift.
  for (const s of sliders) {
    assert.equal(typeof s.v0, 'undefined',
      `pre-fix expectation: slider '${s.name}' should have NO v0 without seeding`);
  }
});

test('GREEN: after seeding, EVERY untouched slider export broadcasts a real numeric v0', () => {
  const ch = loadChannel('01_cylon_sweep.js', { seed: true });
  const exps = serializeExports(ch, host);
  const sliders = exps.filter(e => e.kind === 1);
  assert.ok(sliders.length > 0, 'pattern must declare at least one slider');
  for (const s of sliders) {
    assert.equal(typeof s.v0, 'number',
      `slider '${s.name}' must have a numeric v0 after seeding (was ${JSON.stringify(s.v0)})`);
    // Pixelblaze slider default midpoint.
    assert.equal(s.v0, 0.5, `slider '${s.name}' should seed to the Pixelblaze default 0.5`);
  }
});

test('a touched slider keeps its set value; seeding does NOT clobber it', () => {
  const ch = loadChannel('01_cylon_sweep.js', { seed: false });
  const exps0 = serializeExports(ch, host);
  const target = exps0.find(e => e.kind === 1);
  // Operator moves this one slider to 0.9 BEFORE seeding runs.
  ch.setControl(host, target.id, 0.9, 0, 0);
  const reseeded = ch.seedLocalControlDefaults(host);
  const exps = serializeExports(ch, host);
  const moved = exps.find(e => e.id === target.id);
  assert.equal(moved.v0, 0.9, 'touched slider must retain its operator value');
  // The other sliders still got seeded (count = all sliders minus the touched one).
  const sliderCount = exps.filter(e => e.kind === 1).length;
  assert.equal(reseeded, sliderCount - 1,
    'seeding should fill every slider EXCEPT the one already touched');
});

// Minimal paramRouter mirroring ChannelParamRouter.setChannelControl's effect
// (write into the channel's WASM handle + localControls) so applyEntryDefaults
// behaves exactly as it does in the engine, without booting a mixer/CPC.
function fakeParamRouter() {
  return {
    setChannelControl(_channelId, controlId, v0, v1, v2) {
      // In the real engine `channel` is resolved from the mixer; here the test
      // binds the channel onto the router before use.
      this._channel.setControl(host, controlId, v0, v1, v2);
      return { status: 'ok' };
    },
  };
}

test('DISCARD path: reapplying defaults on an installed handle STILL seeds v0 for untouched no-default sliders', () => {
  // Reproduces api_server.js discard/"Load from playlist" route (~:3890):
  //   ch.localControls = {}; seedLocalControlDefaults; applyEntryDefaults.
  // Load a pattern, let the operator move ONE slider, then hit discard with a
  // saved-defaults set that DOES NOT mention any slider (empty defaults) — the
  // untouched sliders must still broadcast a numeric v0 afterward.
  const ch = loadChannel('01_cylon_sweep.js', { seed: true });
  const sliders0 = serializeExports(ch, host).filter(e => e.kind === 1);
  const moved = sliders0[0];
  ch.setControl(host, moved.id, 0.77, 0, 0); // operator edit in memory

  // Discard: entry with NO saved defaults for any slider (the reopening case).
  const entry = { id: 'e1', pattern: '01_cylon_sweep', defaults: {} };
  const pm = new PlaylistManager(fs.mkdtempSync(path.join(os.tmpdir(), 'v0d_')), PATTERNS_DIR);
  const router = fakeParamRouter();
  router._channel = ch;

  // Exact discard-route sequence:
  ch.localControls = {};
  ch.seedLocalControlDefaults(host);                              // <- the fix
  pm.applyEntryDefaults(ch, entry, host, router, /* paramCenter */ null);

  const after = serializeExports(ch, host).filter(e => e.kind === 1);
  assert.ok(after.length > 0);
  for (const s of after) {
    assert.equal(typeof s.v0, 'number',
      `after discard, slider '${s.name}' must still carry a numeric v0 (was ${JSON.stringify(s.v0)})`);
    assert.equal(s.v0, 0.5, `discard reverts '${s.name}' to the Pixelblaze default 0.5`);
  }
});

test('hsvPicker (kind 6) seeds to h:0 s:1 v:1', () => {
  // test/test_params.js declares `export function hsvPickerColor(h,s,v)`.
  const ch = loadChannel('test/test_params.js', { seed: true });
  const exps = serializeExports(ch, host);
  const hsv = exps.find(e => e.kind === 6);
  assert.ok(hsv, 'test_params must declare an hsvPicker export');
  assert.equal(hsv.v0, 0.0, 'hsv h default 0');
  assert.equal(hsv.v1, 1.0, 'hsv s default 1');
  assert.equal(hsv.v2, 1.0, 'hsv v default 1');
});
