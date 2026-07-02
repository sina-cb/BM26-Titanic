// Driver #2 (MIDI Fighter Twister) profile-layer coverage: the relative-CC
// match flag, the new action kinds + their step validation, the
// configureOnConnect device flag, AND that the SHIPPED midi_profiles/mft.yaml
// validates + loads the way the bundle's yaml-transformer will feed it.
//
// The yaml is parsed here with js-yaml (a devDependency) to mirror the metro
// yaml-transformer at build time — vitest has no yaml transform configured.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import yaml from 'js-yaml';
import { validateProfile, ProfileValidationError, DEFAULT_RELATIVE_STEPS } from './profile';

describe('MFT profile-layer additions', () => {
  const base = {
    device: { id: 'mft', label: 'MFT', nameContains: 'Midi Fighter Twister', sourcePort: 0, destinationPort: 0 },
  };

  it('carries the relative CC flag through validation', () => {
    const p = validateProfile({
      ...base,
      controls: [{ id: 'k0', match: { type: 'cc', channel: 0, cc: 0, relative: true }, action: { kind: 'focusedParamKnob', index: 0 } }],
    });
    const m = p.controls[0].match;
    expect(m.type).toBe('cc');
    expect(m.type === 'cc' && m.relative).toBe(true);
  });

  it('defaults an absent relative flag to false', () => {
    const p = validateProfile({
      ...base,
      controls: [{ id: 'f', match: { type: 'cc', channel: 0, cc: 0 }, action: { kind: 'master' } }],
    });
    const m = p.controls[0].match;
    expect(m.type === 'cc' && m.relative).toBe(false);
  });

  it('defaults focusedParamKnob steps to the ascending triple', () => {
    const p = validateProfile({
      ...base,
      controls: [{ id: 'k', match: { type: 'cc', channel: 0, cc: 0, relative: true }, action: { kind: 'focusedParamKnob', index: 0 } }],
    });
    const a = p.controls[0].action;
    expect(a.kind === 'focusedParamKnob' && a.steps).toEqual(DEFAULT_RELATIVE_STEPS);
  });

  it('accepts a custom ascending steps triple', () => {
    const p = validateProfile({
      ...base,
      controls: [{ id: 'k', match: { type: 'cc', channel: 0, cc: 0, relative: true }, action: { kind: 'focusedParamKnob', index: 0, steps: [0.01, 0.02, 0.09] } }],
    });
    const a = p.controls[0].action;
    expect(a.kind === 'focusedParamKnob' && a.steps).toEqual([0.01, 0.02, 0.09]);
  });

  it('throws on a non-ascending steps triple', () => {
    expect(() => validateProfile({
      ...base,
      controls: [{ id: 'k', match: { type: 'cc', channel: 0, cc: 0, relative: true }, action: { kind: 'focusedParamKnob', index: 0, steps: [0.05, 0.02, 0.06] } }],
    })).toThrow(/strictly ascending/);
  });

  it('throws on a steps triple of the wrong length', () => {
    expect(() => validateProfile({
      ...base,
      controls: [{ id: 'k', match: { type: 'cc', channel: 0, cc: 0, relative: true }, action: { kind: 'focusedParamKnob', index: 0, steps: [0.05, 0.06] } }],
    })).toThrow(/three positive numbers/);
  });

  it('throws on a negative focusedParamKnob index', () => {
    expect(() => validateProfile({
      ...base,
      controls: [{ id: 'k', match: { type: 'cc', channel: 0, cc: 0, relative: true }, action: { kind: 'focusedParamKnob', index: -1 } }],
    })).toThrow(/non-negative integer 'index'/);
  });

  it('validates focusStep dir + tapTempo + focusedParamReset', () => {
    const p = validateProfile({
      ...base,
      controls: [
        { id: 'reset', match: { type: 'cc', channel: 1, cc: 0 }, action: { kind: 'focusedParamReset', index: 0 } },
        { id: 'prev', match: { type: 'cc', channel: 3, cc: 11 }, action: { kind: 'focusStep', dir: 'prev' } },
        { id: 'tap', match: { type: 'cc', channel: 3, cc: 10 }, action: { kind: 'tapTempo' } },
      ],
    });
    expect(p.controls.map((c) => c.action.kind)).toEqual(['focusedParamReset', 'focusStep', 'tapTempo']);
  });

  it('throws on a bad focusStep dir', () => {
    expect(() => validateProfile({
      ...base,
      controls: [{ id: 's', match: { type: 'cc', channel: 3, cc: 11 }, action: { kind: 'focusStep', dir: 'sideways' } }],
    })).toThrow(/focusStep dir must be/);
  });

  it('validates + carries device.configureOnConnect', () => {
    const p = validateProfile({ device: { ...base.device, configureOnConnect: true }, controls: [{ id: 'k', match: { type: 'cc', channel: 0, cc: 0, relative: true }, action: { kind: 'focusedParamKnob', index: 0 } }] });
    expect(p.device.configureOnConnect).toBe(true);
  });

  it('throws when configureOnConnect is not a boolean', () => {
    expect(() => validateProfile({ device: { ...base.device, configureOnConnect: 'yes' }, controls: [{ id: 'k', match: { type: 'cc', channel: 0, cc: 0 }, action: { kind: 'master' } }] }))
      .toThrow(/configureOnConnect must be a boolean/);
  });
});

describe('shipped midi_profiles/mft.yaml', () => {
  const raw = yaml.load(readFileSync(join(__dirname, '../../midi_profiles/mft.yaml'), 'utf8'));

  it('validates and loads', () => {
    const p = validateProfile(raw, 'mft.yaml');
    expect(p.device.id).toBe('mft');
    expect(p.device.nameContains).toBe('Midi Fighter Twister');
    expect(p.device.configureOnConnect).toBe(true);
  });

  it('maps 16 relative knob turns + 16 pushes + focus/tap side buttons', () => {
    const p = validateProfile(raw, 'mft.yaml');
    const kinds = p.controls.map((c) => c.action.kind);
    expect(kinds.filter((k) => k === 'focusedParamKnob')).toHaveLength(16);
    expect(kinds.filter((k) => k === 'focusedParamReset')).toHaveLength(16);
    expect(kinds.filter((k) => k === 'focusStep')).toHaveLength(3);
    expect(kinds.filter((k) => k === 'tapTempo')).toHaveLength(1);
    // Knob 0 turn is a relative CC on the rotary channel (0).
    const knob0 = p.controls.find((c) => c.id === 'knob_0_turn')!;
    expect(knob0.match).toMatchObject({ type: 'cc', channel: 0, cc: 0, relative: true });
    expect(knob0.action).toMatchObject({ kind: 'focusedParamKnob', index: 0 });
  });

  it('throws ProfileValidationError on nothing (all controls unique)', () => {
    expect(() => validateProfile(raw, 'mft.yaml')).not.toThrow(ProfileValidationError);
  });
});
