import { describe, it, expect } from 'vitest';
import { validateProfile, validateProfileParams, ProfileValidationError } from './profile';

const valid = {
  device: { id: 'apc_mini_mk2', label: 'APC mini mk2', nameContains: 'APC mini mk2', sourcePort: 0, destinationPort: 0 },
  controls: [
    { id: 'fader_1', match: { type: 'cc', channel: 0, cc: 48 }, action: { kind: 'paramCenter', key: 'speed', range: [0, 1] } },
    { id: 'pads', match: { type: 'note', channel: 0, notes: [0, 7] }, action: { kind: 'patternBank', bank: 0 }, led: { active: 21, idle: 1, channel: 6 } },
    { id: 'blackout', match: { type: 'note', channel: 0, notes: [107] }, action: { kind: 'blackoutToggle' }, led: { on: 1, off: 0 } },
  ],
};

describe('validateProfile', () => {
  it('accepts and normalises a valid profile', () => {
    const p = validateProfile(valid);
    expect(p.device.id).toBe('apc_mini_mk2');
    expect(p.controls).toHaveLength(3);
  });

  it('throws on a non-object profile', () => {
    expect(() => validateProfile(null)).toThrow(ProfileValidationError);
  });

  it('throws when device fields are missing', () => {
    expect(() => validateProfile({ ...valid, device: { id: 'x' } })).toThrow(/device\./);
  });

  it('throws on an unknown action kind', () => {
    const bad = { ...valid, controls: [{ id: 'c', match: { type: 'cc', channel: 0, cc: 1 }, action: { kind: 'frobnicate' } }] };
    expect(() => validateProfile(bad)).toThrow(/unknown action\.kind 'frobnicate'/);
  });

  it('throws on an out-of-range note', () => {
    const bad = { ...valid, controls: [{ id: 'c', match: { type: 'note', channel: 0, notes: [200] }, action: { kind: 'blackoutToggle' } }] };
    expect(() => validateProfile(bad)).toThrow(/0-127/);
  });

  it('throws on an out-of-range led value', () => {
    const bad = { ...valid, controls: [{ id: 'c', match: { type: 'note', channel: 0, notes: [1] }, action: { kind: 'blackoutToggle' }, led: { on: 200 } }] };
    expect(() => validateProfile(bad)).toThrow(/led\.on/);
  });

  it('throws on overlapping matches', () => {
    const bad = {
      ...valid,
      controls: [
        { id: 'a', match: { type: 'note', channel: 0, notes: [0, 7] }, action: { kind: 'patternBank', bank: 0 } },
        { id: 'b', match: { type: 'note', channel: 0, notes: [5] }, action: { kind: 'blackoutToggle' } },
      ],
    };
    expect(() => validateProfile(bad)).toThrow(/overlaps/);
  });

  it('throws on duplicate control ids', () => {
    const bad = {
      ...valid,
      controls: [
        { id: 'dup', match: { type: 'cc', channel: 0, cc: 1 }, action: { kind: 'master' } },
        { id: 'dup', match: { type: 'cc', channel: 0, cc: 2 }, action: { kind: 'master' } },
      ],
    };
    expect(() => validateProfile(bad)).toThrow(/duplicate control id/);
  });

  it('throws on a paramCenter range with equal min/max', () => {
    const bad = { ...valid, controls: [{ id: 'c', match: { type: 'cc', channel: 0, cc: 1 }, action: { kind: 'paramCenter', key: 'speed', range: [1, 1] } }] };
    expect(() => validateProfile(bad)).toThrow(/min and max must differ/);
  });
});

describe('validateProfileParams', () => {
  const profile = validateProfile(valid);

  it('reports unknown param keys (non-strict, aggregate)', () => {
    const errs = validateProfileParams(profile, new Set(['size', 'rotate']));
    expect(errs).toEqual([{ controlId: 'fader_1', key: 'speed' }]);
  });

  it('returns no errors when all keys exist', () => {
    expect(validateProfileParams(profile, new Set(['speed']))).toEqual([]);
  });

  it('throws on an unknown key in strict mode', () => {
    expect(() => validateProfileParams(profile, new Set(['size']), { strict: true })).toThrow(/not in the engine CPC schema/);
  });

  // ── N2: paramCenterRelative keys (MFT bank-2 knobs) are validated too ──
  // A bogus relative key (e.g. a misspelled 'speed') otherwise sails through
  // validation and dies silently at runtime. It must be held to the same schema.
  const relativeProfile = validateProfile({
    device: { id: 'mft', label: 'MFT', nameContains: 'Midi Fighter Twister', sourcePort: 0, destinationPort: 0 },
    controls: [
      { id: 'b2_speed', match: { type: 'cc', channel: 0, cc: 16, relative: true }, action: { kind: 'paramCenterRelative', key: 'speeed' } },
    ],
  });

  it('reports an unknown paramCenterRelative key (non-strict, names the key)', () => {
    const errs = validateProfileParams(relativeProfile, new Set(['speed', 'size', 'rotate']));
    expect(errs).toEqual([{ controlId: 'b2_speed', key: 'speeed' }]);
  });

  it('THROWS naming the bogus paramCenterRelative key in strict mode (N2)', () => {
    expect(() => validateProfileParams(relativeProfile, new Set(['speed']), { strict: true }))
      .toThrow(/paramCenterRelative key 'speeed' is not in the engine CPC schema/);
  });

  it('accepts a valid paramCenterRelative key against the schema', () => {
    const good = validateProfile({
      device: { id: 'mft', label: 'MFT', nameContains: 'Midi Fighter Twister', sourcePort: 0, destinationPort: 0 },
      controls: [
        { id: 'b2_speed', match: { type: 'cc', channel: 0, cc: 16, relative: true }, action: { kind: 'paramCenterRelative', key: 'speed' } },
      ],
    });
    expect(validateProfileParams(good, new Set(['speed']))).toEqual([]);
  });
});
