// Unit tests for StateManager atomic writes + serializeChannel de-dup.
// Run:  node --test tests/state_atomicity.test.js
//
// These tests pin two hardening guarantees added on dev/engine_state_hardening:
//   1. Atomic state writes — a crash mid-write never corrupts the previous
//      good file (temp-file + atomic-rename semantics), and a normal save
//      still round-trips.
//   2. serializeChannel — the de-dup helper used by saveDeckState /
//      saveMixerState produces the exact on-disk shape the engine restores.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import yaml from 'js-yaml';

import { StateManager, serializeChannel } from '../lib/state_manager.js';

function tmpStateDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'state_atomicity_'));
}

// A minimal stand-in for a PatternChannel: serializeChannel only reads
// plain fields, so a literal is a faithful fixture.
function fakeChannel(overrides = {}) {
  return {
    id: 'ch_base_123',
    name: 'Base',
    pattern: '29_bar_dancers',
    mode: 'blend_screen',
    fader: 1,
    enabled: true,
    locked: false,
    faderLocked: false,
    localControls: { '111': { v0: 0.5, v1: 0, v2: 0 } },
    playlist: { name: 'default', activeEntryId: 'e_1', cursor: 0 },
    viewSelection: { type: 'all', target: null, invert: false },
    ...overrides,
  };
}

test('save round-trips a normal state through disk', () => {
  const dir = tmpStateDir();
  const sm = new StateManager(dir);
  const state = { master: 0.75, channels: [], note: 'hello' };
  sm.save('round_trip.yaml', state);
  const onDisk = yaml.load(fs.readFileSync(path.join(dir, 'round_trip.yaml'), 'utf8'));
  assert.deepEqual(onDisk, state);
});

test('save then load via the public load() helper returns the same object', () => {
  const dir = tmpStateDir();
  const sm = new StateManager(dir);
  const state = { blackout: true, params: { speed: { value: 0.5 } } };
  sm.save('globals_state.yaml', state);
  assert.deepEqual(sm.load('globals_state.yaml', null), state);
});

test('atomic write leaves no .tmp residue after a successful save', () => {
  const dir = tmpStateDir();
  const sm = new StateManager(dir);
  sm.save('a.yaml', { x: 1 });
  sm.save('a.yaml', { x: 2 });
  const leftovers = fs.readdirSync(dir).filter(f => f.endsWith('.tmp'));
  assert.deepEqual(leftovers, [], `unexpected temp residue: ${leftovers.join(', ')}`);
});

test('a failed write does NOT corrupt the previous good file', () => {
  const dir = tmpStateDir();
  const sm = new StateManager(dir);
  const good = { master: 1, channels: [{ id: 'ch_1' }] };
  sm.save('mixer_state.yaml', good);
  const goodBytes = fs.readFileSync(path.join(dir, 'mixer_state.yaml'), 'utf8');

  // Force the serialization step to throw — yaml.dump on a BigInt throws
  // ("unacceptable kind of an object to dump") BEFORE any bytes are
  // written. The previous good file must be untouched (no truncation, no
  // partial overwrite). save() swallows the error by design (api_server
  // depends on a non-throwing save), so we assert the on-disk invariant
  // rather than an exception.
  sm.save('mixer_state.yaml', { master: 10n });

  const afterBytes = fs.readFileSync(path.join(dir, 'mixer_state.yaml'), 'utf8');
  assert.equal(afterBytes, goodBytes, 'previous good file was corrupted by a failed write');
  assert.deepEqual(yaml.load(afterBytes), good);
  // And no half-written temp file should survive a failed write.
  const leftovers = fs.readdirSync(dir).filter(f => f.endsWith('.tmp'));
  assert.deepEqual(leftovers, [], `temp file leaked after failed write: ${leftovers.join(', ')}`);
});

test('_writeFileAtomic re-throws on serialization-independent IO failure and cleans temp', () => {
  const dir = tmpStateDir();
  const sm = new StateManager(dir);
  // Renaming over a path that is itself a directory must fail. We point the
  // destination at a subdirectory to provoke an EISDIR/EPERM on rename, then
  // confirm the helper re-throws (loud failure, no silent swallow) and that
  // the temp file is unlinked.
  const subdir = path.join(dir, 'isdir.yaml');
  fs.mkdirSync(subdir);
  assert.throws(() => sm._writeFileAtomic(subdir, 'data: 1\n'));
  const leftovers = fs.readdirSync(dir).filter(f => f.endsWith('.tmp'));
  assert.deepEqual(leftovers, [], `temp file leaked after IO failure: ${leftovers.join(', ')}`);
});

test('atomic rename swaps in the new complete file (old fully replaced)', () => {
  const dir = tmpStateDir();
  const sm = new StateManager(dir);
  sm.save('deck_state.yaml', { channel: { id: 'old', pattern: 'p_old' } });
  sm.save('deck_state.yaml', { channel: { id: 'new', pattern: 'p_new' } });
  const onDisk = yaml.load(fs.readFileSync(path.join(dir, 'deck_state.yaml'), 'utf8'));
  assert.equal(onDisk.channel.id, 'new');
  assert.equal(onDisk.channel.pattern, 'p_new');
});

// ── serializeChannel shape ──────────────────────────────────────────────

test('serializeChannel emits exactly the fields the engine restores', () => {
  const out = serializeChannel(fakeChannel());
  assert.deepEqual(Object.keys(out), [
    'id', 'name', 'pattern', 'mode', 'fader', 'enabled',
    'locked', 'faderLocked', 'localControls', 'playlist', 'viewSelection',
    // Additive (channel_features wave): appended AFTER viewSelection so the
    // pre-existing key order for all earlier fields is unchanged.
    'faderMax', 'color',
    // Additive (groups + solo wave, WAVE 15): appended AFTER faderMax/color.
    'mixGroupId', 'soloSafe',
    // Additive (hue shifter wave, 2026-06): appended AFTER mixGroupId/soloSafe.
    'hue',
    // Additive (invert wave, 2026-06): appended AFTER hue.
    'invert',
    // Additive (phase-clock wave, 2026-06): appended AFTER invert. Per-channel
    // phase clock (F-phase): speed/phaseOffsetMs/followsTempo.
    'speed', 'phaseOffsetMs', 'followsTempo',
  ]);
});

test('serializeChannel coerces lock flags to booleans', () => {
  const out = serializeChannel(fakeChannel({ locked: 1, faderLocked: 0 }));
  assert.equal(out.locked, true);
  assert.equal(out.faderLocked, false);
});

test('serializeChannel defaults playlist to null and viewSelection to ALL', () => {
  const out = serializeChannel(fakeChannel({ playlist: undefined, viewSelection: undefined }));
  assert.equal(out.playlist, null);
  assert.deepEqual(out.viewSelection, { type: 'all', target: null, invert: false });
});

// ── F-C / F-D additive schema fields ────────────────────────────────────

test('serializeChannel defaults faderMax to 1.0 and color to null when absent', () => {
  const out = serializeChannel(fakeChannel({ faderMax: undefined, color: undefined }));
  assert.equal(out.faderMax, 1.0, 'absent faderMax ⇒ documented default 1.0');
  assert.equal(out.color, null, 'absent color ⇒ documented default null');
});

test('serializeChannel round-trips a set faderMax and color', () => {
  const out = serializeChannel(fakeChannel({ faderMax: 0.4, color: '#ff8800' }));
  assert.equal(out.faderMax, 0.4);
  assert.equal(out.color, '#ff8800');
});

test('serializeChannel clamps an out-of-range faderMax to [0,1]', () => {
  assert.equal(serializeChannel(fakeChannel({ faderMax: 2.5 })).faderMax, 1.0);
  assert.equal(serializeChannel(fakeChannel({ faderMax: -0.5 })).faderMax, 0.0);
});

test('serializeChannel coerces a non-string color to null (no silent garbage)', () => {
  assert.equal(serializeChannel(fakeChannel({ color: 123 })).color, null);
});

test('saveMixerState persists faderMax and color on overlays', () => {
  const dir = tmpStateDir();
  const sm = new StateManager(dir);
  const overlay = fakeChannel({ id: 'ch_overlay_fc', faderMax: 0.3, color: '#abcdef' });
  const mixer = { master: 1, getMixerChannels: () => [overlay] };
  sm.saveMixerState(mixer);
  const onDisk = yaml.load(fs.readFileSync(path.join(dir, 'mixer_state.yaml'), 'utf8'));
  assert.equal(onDisk.channels[0].faderMax, 0.3);
  assert.equal(onDisk.channels[0].color, '#abcdef');
});

test('legacy state file without faderMax/color still loads (backward-compatible)', () => {
  const dir = tmpStateDir();
  const sm = new StateManager(dir);
  // Simulate a pre-channel_features mixer_state.yaml (no faderMax/color keys).
  const legacy = {
    master: 0.8,
    channels: [{
      id: 'ch_legacy', name: 'Legacy', pattern: 'p', mode: 'blend_screen',
      fader: 1, enabled: true, locked: false, faderLocked: false,
      transitionMode: 'trans_crossfade', transitionTime: 1,
      localControls: {}, playlist: null,
      viewSelection: { type: 'all', target: null, invert: false },
    }],
  };
  sm.save('mixer_state.yaml', legacy);
  const loaded = sm.loadMixerState();
  assert.equal(loaded.channels.length, 1);
  assert.equal(loaded.channels[0].faderMax, undefined,
    'legacy file has no faderMax — restore path supplies the default, not the loader');
  assert.equal(loaded.channels[0].color, undefined);
});

test('saveDeckState writes the serializeChannel core shape verbatim', () => {
  const dir = tmpStateDir();
  const sm = new StateManager(dir);
  const baseCh = fakeChannel();
  const mixer = { getDeckChannel: () => baseCh };
  sm.saveDeckState(mixer);
  const onDisk = yaml.load(fs.readFileSync(path.join(dir, 'deck_state.yaml'), 'utf8'));
  assert.deepEqual(onDisk.channel, serializeChannel(baseCh));
});

test('saveDeckState still merges extras alongside channel', () => {
  const dir = tmpStateDir();
  const sm = new StateManager(dir);
  const mixer = { getDeckChannel: () => fakeChannel() };
  sm.saveDeckState(mixer, { transitionConfig: { enabled: false, mode: 'trans_crossfade' } });
  const onDisk = yaml.load(fs.readFileSync(path.join(dir, 'deck_state.yaml'), 'utf8'));
  assert.ok(onDisk.channel);
  assert.deepEqual(onDisk.transitionConfig, { enabled: false, mode: 'trans_crossfade' });
});

test('saveMixerState preserves on-disk key order and overlay-only fields', () => {
  const dir = tmpStateDir();
  const sm = new StateManager(dir);
  const overlay = fakeChannel({
    id: 'ch_overlay_1',
    name: 'New Layer',
    transitionMode: 'trans_crossfade',
    transitionTime: 1,
  });
  const mixer = { master: 1, getMixerChannels: () => [overlay] };
  sm.saveMixerState(mixer);
  const onDisk = yaml.load(fs.readFileSync(path.join(dir, 'mixer_state.yaml'), 'utf8'));
  assert.equal(onDisk.master, 1);
  assert.equal(onDisk.channels.length, 1);
  // Exact key order must match the pre-refactor schema so the file stays
  // byte-compatible and downstream YAML diffs stay clean.
  assert.deepEqual(Object.keys(onDisk.channels[0]), [
    'id', 'name', 'pattern', 'mode', 'fader', 'enabled', 'locked', 'faderLocked',
    'transitionMode', 'transitionTime', 'localControls', 'playlist', 'viewSelection',
    // Additive (channel_features wave): appended after the existing overlay
    // fields so legacy mixer_state.yaml files still load.
    'faderMax', 'color',
    // Additive (groups + solo wave, WAVE 15): appended after faderMax/color.
    'mixGroupId', 'soloSafe',
    // Additive (hue shifter wave, 2026-06): appended after mixGroupId/soloSafe.
    'hue',
    // Additive (invert wave, 2026-06): appended after hue.
    'invert',
    // Additive (phase-clock wave, 2026-06): appended after invert.
    'speed', 'phaseOffsetMs', 'followsTempo',
  ]);
});

test('saveMixerState never persists a live trans_* mode (coerced to blend_screen)', () => {
  const dir = tmpStateDir();
  const sm = new StateManager(dir);
  const overlay = fakeChannel({ id: 'ch_overlay_2', mode: 'trans_flash' });
  const mixer = { master: 1, getMixerChannels: () => [overlay] };
  sm.saveMixerState(mixer);
  const onDisk = yaml.load(fs.readFileSync(path.join(dir, 'mixer_state.yaml'), 'utf8'));
  assert.equal(onDisk.channels[0].mode, 'blend_screen');
});
