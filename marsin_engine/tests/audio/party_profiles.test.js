import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  DEFAULT_PARTY_PROFILES,
  loadPartyProfiles,
  savePartyProfiles,
  slugifyPartyProfile,
  uniquePartyProfileId,
  validatePartyProfile,
  validatePartyProfiles,
} from '../../audio/companion/party_profiles.js';

const playa = DEFAULT_PARTY_PROFILES[0];

test('party profile ids are safe and unique', () => {
  assert.equal(slugifyPartyProfile('Home stereo!'), 'home_stereo');
  assert.equal(uniquePartyProfileId('Home', new Set(['home'])), 'home_2');
});

test('default profiles preserve Playa and loosen Home', () => {
  const state = validatePartyProfiles(DEFAULT_PARTY_PROFILES, 'home');
  const playaProfile = state.profiles.find((profile) => profile.id === 'playa');
  const homeProfile = state.profiles.find((profile) => profile.id === 'home');
  assert.deepEqual(playaProfile.params, {
    ambientFloor: 0.09,
    marginX: 2.5,
    kickRateMin: 1.2,
    kickRateMax: 3.8,
    kickRegMin: 0.45,
    requireBpmLock: true,
    shapeLowMin: 0.2,
    shapeHighMin: 0.12,
    silenceMax: 0.5,
    onSustainMs: 20000,
    offConfirmMs: 30000,
  });
  assert.ok(homeProfile.params.ambientFloor < playaProfile.params.ambientFloor);
  assert.ok(homeProfile.params.marginX < playaProfile.params.marginX);
  assert.ok(homeProfile.params.kickRegMin < playaProfile.params.kickRegMin);
  assert.ok(homeProfile.params.shapeHighMin < playaProfile.params.shapeHighMin);
  assert.ok(homeProfile.params.onSustainMs < playaProfile.params.onSustainMs);
});

test('party profiles require every known, bounded detector parameter', () => {
  assert.throws(() => validatePartyProfile({ name: 'Bad', params: {} }), /missing params/);
  assert.throws(() => validatePartyProfile({
    name: 'Bad',
    params: { ...playa.params, requireBpmLock: 1 },
  }), /must be a boolean/);
  assert.throws(() => validatePartyProfile({
    name: 'Bad',
    params: { ...playa.params, kickRateMin: 5, kickRateMax: 2 },
  }), /exceeds/);
  assert.throws(() => validatePartyProfile({
    name: 'Bad',
    params: { ...playa.params, mystery: 1 },
  }), /unknown params/);
});

test('active party profile and custom profiles persist across reloads', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'party-profiles-'));
  try {
    const seeded = loadPartyProfiles(dir);
    assert.equal(seeded.activeId, 'home');
    const custom = validatePartyProfile({
      name: 'Living room',
      params: { ...seeded.profiles[1].params, onSustainMs: 10000 },
    });
    savePartyProfiles(dir, [...seeded.profiles, custom], custom.id);
    const reloaded = loadPartyProfiles(dir);
    assert.equal(reloaded.activeId, 'living_room');
    assert.equal(reloaded.profiles[2].params.onSustainMs, 10000);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a malformed persisted party profile file fails loudly', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'party-profiles-'));
  try {
    fs.writeFileSync(
      path.join(dir, 'party_profiles.yaml'),
      'activeId: missing\nprofiles:\n  - id: bad\n    name: Bad\n    params: {}\n',
    );
    assert.throws(() => loadPartyProfiles(dir), /missing params/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
