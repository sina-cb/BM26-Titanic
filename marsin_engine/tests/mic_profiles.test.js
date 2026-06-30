import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  DEFAULT_PROFILES, slugify, uniqueProfileId, validateProfile, validateProfiles,
  loadMicProfiles, saveMicProfiles,
} from '../audio/companion/mic_profiles.js';

test('slugify makes safe non-empty ids', () => {
  assert.equal(slugify('Art car near'), 'art_car_near');
  assert.equal(slugify('  Quiet ROOM!!  '), 'quiet_room');
  assert.equal(slugify('***'), 'profile');     // no usable chars → fallback id
});

test('uniqueProfileId avoids collisions', () => {
  const ids = new Set(['quiet_room']);
  assert.equal(uniqueProfileId('New', ids), 'new');
  assert.equal(uniqueProfileId('Quiet room', ids), 'quiet_room_2');
  ids.add('quiet_room_2');
  assert.equal(uniqueProfileId('Quiet room', ids), 'quiet_room_3');
});

test('validateProfile normalizes + fills defaults', () => {
  const p = validateProfile({ name: 'Test', gates: { noiseGate: 0.05 } });
  assert.equal(p.id, 'test');
  assert.equal(p.gates.noiseGate, 0.05);
  assert.equal(p.gates.lowGate, null);        // absent per-band → null (use global)
  assert.equal(p.inputGain, 1.0);             // default gain
});

test('validateProfile rejects malformed values (codex P0 — no silent fix)', () => {
  assert.throws(() => validateProfile({ gates: { noiseGate: 0.1 } }));          // no name
  assert.throws(() => validateProfile({ name: 'x', gates: {} }));                // no noiseGate
  assert.throws(() => validateProfile({ name: 'x', gates: { noiseGate: 1.0 } })); // gate must be < 1
  assert.throws(() => validateProfile({ name: 'x', gates: { noiseGate: 0.1, lowGate: 2 } }));
  assert.throws(() => validateProfile({ name: 'x', gates: { noiseGate: 0.1 }, inputGain: 999 }));
});

test('validateProfiles rejects duplicate ids and empty lists', () => {
  assert.throws(() => validateProfiles([]));
  assert.throws(() => validateProfiles([
    { id: 'a', name: 'A', gates: { noiseGate: 0.04 } },
    { id: 'a', name: 'A2', gates: { noiseGate: 0.05 } },
  ]));
  const ok = validateProfiles(DEFAULT_PROFILES);
  assert.equal(ok.length, 5);
  assert.equal(ok[0].name, 'Quiet room');
});

test('load returns defaults when the file is missing; save round-trips', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'micprof-'));
  try {
    const def = loadMicProfiles(dir);                 // ENOENT → defaults
    assert.equal(def.length, 5);
    const next = [...def, validateProfile({ name: 'Art car near', gates: { noiseGate: 0.06, lowGate: 0.7, midGate: 0.6, highGate: 0.6 } })];
    saveMicProfiles(dir, next);
    const reloaded = loadMicProfiles(dir);
    assert.equal(reloaded.length, 6);
    assert.equal(reloaded[5].id, 'art_car_near');
    assert.equal(reloaded[5].gates.lowGate, 0.7);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('load throws on a present-but-malformed file (no silent fallback)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'micprof-'));
  try {
    fs.writeFileSync(path.join(dir, 'mic_profiles.yaml'), 'profiles:\n  - name: bad\n    gates: {}\n');
    assert.throws(() => loadMicProfiles(dir));        // missing noiseGate → throw
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
