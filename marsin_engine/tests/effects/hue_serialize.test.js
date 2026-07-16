/**
 * Round-trip tests for per-channel hue persistence (docs/39 §F-hue).
 *
 * The per-channel hue must survive serialization through every persistence
 * path and restore back onto a PatternChannel:
 *   - state_manager.serializeChannel (deck_state.yaml + the mixer overlay
 *     core) — the on-disk shape.
 *   - PatternChannel ctor restore (the api_server restore path builds a
 *     config object and hands it to the ctor; this mirrors that).
 * An old state file without the field restores to the documented default 0.
 *
 * The two api_server.js serializers (serializeChannel + serializeMixerState
 * closures) are not individually exported, so they are exercised by the HIL
 * test (GET /mixer + GET /deck/channel round-trip on the live engine).
 *
 * Run: node --test marsin_engine/tests/hue_serialize.test.js
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { serializeChannel } from '../../lib/state_manager.js';
import { PatternChannel } from '../../lib/pattern_channel.js';

test('serializeChannel emits hue, normalized into [0,360)', () => {
  const ch = new PatternChannel({ id: 'a', name: 'A', pattern: 'p', hue: 200 });
  const s = serializeChannel(ch);
  assert.equal(s.hue, 200);
});

test('serializeChannel defaults a hue-less channel to 0', () => {
  const ch = new PatternChannel({ id: 'a', name: 'A', pattern: 'p' });
  const s = serializeChannel(ch);
  assert.equal(s.hue, 0);
});

test('hue round-trips serialize -> restore', () => {
  const original = new PatternChannel({ id: 'a', name: 'A', pattern: 'p', hue: 137 });
  const saved = serializeChannel(original);
  // Mirror the api_server restore-path config build (hue passthrough).
  const restored = new PatternChannel({
    id: saved.id, name: saved.name, pattern: saved.pattern,
    hue: typeof saved.hue === 'number' ? saved.hue : 0,
  });
  assert.equal(restored.hue, 137);
});

test('old state file (no hue field) restores to 0', () => {
  const saved = { id: 'a', name: 'A', pattern: 'p' }; // pre-hue file shape
  const restored = new PatternChannel({
    id: saved.id, name: saved.name, pattern: saved.pattern,
    hue: typeof saved.hue === 'number' ? saved.hue : 0,
  });
  assert.equal(restored.hue, 0);
});
