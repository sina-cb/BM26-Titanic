// Unit tests for the deck/mixer channel-split invariants (May 2026 split).
// Run:  node --test tests/deck_mixer_invariants.test.js
//
// These are pure-additive guards: they assert the post-split invariants that
// keep the deck channel from leaking into the mixer overlay stack and back.
// They construct PatternMixer / StateManager directly with stubs — no engine
// boot, no WASM, no disk for the mixer cases.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import { PatternMixer } from '../../lib/pattern_mixer.js';
import { StateManager } from '../../lib/state_manager.js';

// Minimal wasmHost stub: only destroy() is exercised by removeMixerChannel,
// and it must be a no-op that doesn't throw on a fake handle.
const wasmHostStub = { destroy() {} };

function makeMixer(maxChannels) {
  return new PatternMixer({ wasmHost: wasmHostStub, pixelCount: 8, maxChannels });
}

test('deck channel id is never present in mixerChannels', () => {
  const mixer = makeMixer(4);
  mixer.setDeckChannel({ id: 'ch_base_1', name: 'Base', pattern: 'p_deck' });
  mixer.addMixerChannel({ id: 'ch_overlay_1', name: 'L1', pattern: 'p1' });
  mixer.addMixerChannel({ id: 'ch_overlay_2', name: 'L2', pattern: 'p2' });

  const mixerIds = mixer.getMixerChannels().map(c => c.id);
  assert.ok(!mixerIds.includes('ch_base_1'), 'deck id leaked into mixerChannels');
  assert.equal(mixer.getDeckChannel().id, 'ch_base_1');
  // The combined compatibility view puts the deck first, then overlays.
  assert.deepEqual(mixer.channels.map(c => c.id), ['ch_base_1', 'ch_overlay_1', 'ch_overlay_2']);
});

test('addMixerChannel refuses to reuse the deck channel id', () => {
  const mixer = makeMixer(4);
  mixer.setDeckChannel({ id: 'ch_base_1', name: 'Base', pattern: 'p_deck' });
  assert.throws(
    () => mixer.addMixerChannel({ id: 'ch_base_1', name: 'dup', pattern: 'p' }),
    /reserved for the deck channel/,
  );
});

test('mixer respects the maxChannels cap from config (deck does not count)', () => {
  const mixer = makeMixer(2);
  mixer.setDeckChannel({ id: 'ch_base_1', name: 'Base', pattern: 'p_deck' });
  mixer.addMixerChannel({ id: 'ch_o1', name: 'L1', pattern: 'p1' });
  mixer.addMixerChannel({ id: 'ch_o2', name: 'L2', pattern: 'p2' });
  // Deck + 2 overlays is fine; the third overlay must be rejected.
  assert.equal(mixer.getMixerChannels().length, 2);
  assert.throws(
    () => mixer.addMixerChannel({ id: 'ch_o3', name: 'L3', pattern: 'p3' }),
    /Maximum of 2 mixer channels allowed/,
  );
});

test('maxChannels falls back to a sane default for invalid config', () => {
  const m1 = new PatternMixer({ wasmHost: wasmHostStub, pixelCount: 8, maxChannels: 0 });
  const m2 = new PatternMixer({ wasmHost: wasmHostStub, pixelCount: 8, maxChannels: undefined });
  assert.equal(m1.maxChannels, 3);
  assert.equal(m2.maxChannels, 3);
});

test('removeMixerChannel refuses to remove the deck channel by id', () => {
  const mixer = makeMixer(4);
  mixer.setDeckChannel({ id: 'ch_base_1', name: 'Base', pattern: 'p_deck' });
  assert.equal(mixer.removeMixerChannel('ch_base_1'), false);
  assert.ok(mixer.getDeckChannel(), 'deck channel was removed via mixer path');
});

test('getMixerChannel rejects the deck id, getChannel finds both', () => {
  const mixer = makeMixer(4);
  mixer.setDeckChannel({ id: 'ch_base_1', name: 'Base', pattern: 'p_deck' });
  mixer.addMixerChannel({ id: 'ch_o1', name: 'L1', pattern: 'p1' });
  assert.equal(mixer.getMixerChannel('ch_base_1'), null);
  assert.equal(mixer.getMixerChannel('ch_o1').id, 'ch_o1');
  assert.equal(mixer.getChannel('ch_base_1').id, 'ch_base_1');
  assert.equal(mixer.getChannel('ch_o1').id, 'ch_o1');
});

// ── Legacy pre-split mixer_state migration (StateManager.loadMixerState) ──

function tmpStateDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'deck_mixer_migrate_'));
}

test('loadMixerState migrates a legacy file with the deck at channels[0]', () => {
  const dir = tmpStateDir();
  const sm = new StateManager(dir);
  // Pre-split combined format: deck (ch_base*) at index 0, overlays after.
  sm.save('mixer_state.yaml', {
    master: 1,
    channels: [
      { id: 'ch_base_legacy', name: 'Base', pattern: 'p_deck' },
      { id: 'ch_overlay_1', name: 'L1', pattern: 'p1' },
      { id: 'ch_overlay_2', name: 'L2', pattern: 'p2' },
    ],
  });
  const loaded = sm.loadMixerState();
  const ids = loaded.channels.map(c => c.id);
  assert.ok(!ids.includes('ch_base_legacy'), 'legacy deck entry not split out of mixer state');
  assert.deepEqual(ids, ['ch_overlay_1', 'ch_overlay_2']);
});

test('loadMixerState is idempotent on an already-split (modern) file', () => {
  const dir = tmpStateDir();
  const sm = new StateManager(dir);
  sm.save('mixer_state.yaml', {
    master: 1,
    channels: [
      { id: 'ch_overlay_1', name: 'L1', pattern: 'p1' },
      { id: 'ch_overlay_2', name: 'L2', pattern: 'p2' },
    ],
  });
  const loaded = sm.loadMixerState();
  assert.deepEqual(loaded.channels.map(c => c.id), ['ch_overlay_1', 'ch_overlay_2']);
});

test('loadMixerState on an empty/missing file returns the default shape', () => {
  const dir = tmpStateDir();
  const sm = new StateManager(dir);
  const loaded = sm.loadMixerState();
  assert.equal(loaded.master, 1.0);
  assert.deepEqual(loaded.channels, []);
});
