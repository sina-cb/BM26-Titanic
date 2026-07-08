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
import { resolveEvent } from './resolver';
import { decodeMidi } from './midi_message';
import { projectLeds, MidiProjectionState } from './led_projector';

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

  it('validates focusStep dir + focusedParamReset', () => {
    const p = validateProfile({
      ...base,
      controls: [
        { id: 'reset', match: { type: 'cc', channel: 1, cc: 0 }, action: { kind: 'focusedParamReset', index: 0 } },
        { id: 'prev', match: { type: 'cc', channel: 3, cc: 11 }, action: { kind: 'focusStep', dir: 'prev' } },
      ],
    });
    expect(p.controls.map((c) => c.action.kind)).toEqual(['focusedParamReset', 'focusStep']);
  });

  it('rejects the removed tapTempo action kind (unbuildable — Audio Companion owns tempo)', () => {
    expect(() => validateProfile({
      ...base,
      controls: [{ id: 'tap', match: { type: 'cc', channel: 3, cc: 10 }, action: { kind: 'tapTempo' } }],
    })).toThrow(/unknown action.kind 'tapTempo'/);
  });

  it('validates paramCenterRelative with default steps', () => {
    const p = validateProfile({
      ...base,
      controls: [
        { id: 'g_speed', match: { type: 'cc', channel: 0, cc: 0, relative: true }, action: { kind: 'paramCenterRelative', key: 'speed' } },
      ],
    });
    const a = p.controls[0].action;
    expect(a.kind === 'paramCenterRelative' && a.key).toBe('speed');
    expect(a.kind === 'paramCenterRelative' && a.steps).toEqual(DEFAULT_RELATIVE_STEPS);
  });

  it('validates the v2 row-0 kinds: bpmSyncToggle, globalHueKnob (steps), globalHueReset', () => {
    const p = validateProfile({
      ...base,
      controls: [
        { id: 'sync', match: { type: 'cc', channel: 1, cc: 0 }, action: { kind: 'bpmSyncToggle' } },
        { id: 'hue', match: { type: 'cc', channel: 0, cc: 1, relative: true }, action: { kind: 'globalHueKnob' } },
        { id: 'hue_reset', match: { type: 'cc', channel: 1, cc: 1 }, action: { kind: 'globalHueReset' } },
      ],
    });
    expect(p.controls.map((c) => c.action.kind)).toEqual(['bpmSyncToggle', 'globalHueKnob', 'globalHueReset']);
    const hue = p.controls[1].action;
    expect(hue.kind === 'globalHueKnob' && hue.steps).toEqual(DEFAULT_RELATIVE_STEPS);
  });

  it('globalHueKnob steps are validated like every relative knob (ascending triple)', () => {
    expect(() => validateProfile({
      ...base,
      controls: [{ id: 'hue', match: { type: 'cc', channel: 0, cc: 1, relative: true }, action: { kind: 'globalHueKnob', steps: [0.1, 0.05, 0.2] } }],
    })).toThrow(/strictly ascending/);
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

describe('shipped midi_profiles/mft.yaml (UX v2 layout)', () => {
  const raw = yaml.load(readFileSync(join(__dirname, '../../midi_profiles/mft.yaml'), 'utf8'));

  it('validates and loads', () => {
    const p = validateProfile(raw, 'mft.yaml');
    expect(p.device.id).toBe('mft');
    expect(p.device.nameContains).toBe('Midi Fighter Twister');
    expect(p.device.configureOnConnect).toBe(true);
  });

  it('row 0: speed knob (0,0) with sync-toggle push + hue knob (0,1) with reset push', () => {
    const p = validateProfile(raw, 'mft.yaml');
    const speed = p.controls.find((c) => c.id === 'global_speed_turn')!;
    expect(speed.match).toMatchObject({ type: 'cc', channel: 0, cc: 0, relative: true });
    expect(speed.action).toMatchObject({ kind: 'paramCenterRelative', key: 'speed' });
    expect(speed.led).toMatchObject({ on: 50, off: 80 }); // sync GREEN / rest RED
    const syncPush = p.controls.find((c) => c.id === 'global_speed_push_sync')!;
    expect(syncPush.match).toMatchObject({ type: 'cc', channel: 1, cc: 0 });
    expect(syncPush.action).toEqual({ kind: 'bpmSyncToggle' });
    const hue = p.controls.find((c) => c.id === 'global_hue_turn')!;
    expect(hue.match).toMatchObject({ type: 'cc', channel: 0, cc: 1, relative: true });
    expect(hue.action).toMatchObject({ kind: 'globalHueKnob' });
    expect(hue.led).toMatchObject({ off: 80 }); // rest RED until hue state loads
    const hueReset = p.controls.find((c) => c.id === 'global_hue_push_reset')!;
    expect(hueReset.match).toMatchObject({ type: 'cc', channel: 1, cc: 1 });
    expect(hueReset.action).toEqual({ kind: 'globalHueReset' });
  });

  it('row 0: encoders 2 and 3 are UNASSIGNED (no control on ch0/ch1 cc 2-3, nothing resolves)', () => {
    const p = validateProfile(raw, 'mft.yaml');
    for (const cc of [2, 3]) {
      for (const ch of [0, 1]) {
        expect(p.controls.find((c) => c.match.type === 'cc' && c.match.channel === ch && c.match.cc === cc)).toBeUndefined();
      }
      // A turn / push on them emits NOTHING (loud silence).
      expect(resolveEvent(p, decodeMidi([0xb0, cc, 65]))).toBeNull();
      expect(resolveEvent(p, decodeMidi([0xb1, cc, 127]))).toBeNull();
    }
  });

  it('rows 1-3: 12 local knobs, encoder e → focused export e-4, pushes remapped alike', () => {
    const p = validateProfile(raw, 'mft.yaml');
    const kinds = p.controls.map((c) => c.action.kind);
    expect(kinds.filter((k) => k === 'focusedParamKnob')).toHaveLength(12);
    expect(kinds.filter((k) => k === 'focusedParamReset')).toHaveLength(12);
    for (let enc = 4; enc <= 15; enc += 1) {
      const turn = p.controls.find((c) => c.match.type === 'cc' && c.match.channel === 0 && c.match.cc === enc)!;
      expect(turn.action).toMatchObject({ kind: 'focusedParamKnob', index: enc - 4 });
      expect(turn.match).toMatchObject({ relative: true });
      const push = p.controls.find((c) => c.match.type === 'cc' && c.match.channel === 1 && c.match.cc === enc)!;
      expect(push.action).toEqual({ kind: 'focusedParamReset', index: enc - 4 });
    }
  });

  it('banks 2-4 are COMPLETELY unmapped (no control on cc 16-63, any channel)', () => {
    const p = validateProfile(raw, 'mft.yaml');
    for (const c of p.controls) {
      if (c.match.type !== 'cc') continue;
      if (c.match.channel === 3) continue; // side buttons live on ch3 (cc 11-13)
      expect(c.match.cc).toBeLessThan(16);
    }
    // The old bank-2 speed/size/rotate globals are gone.
    expect(resolveEvent(p, decodeMidi([0xb0, 16, 65]))).toBeNull();
    expect(resolveEvent(p, decodeMidi([0xb0, 17, 65]))).toBeNull();
    expect(resolveEvent(p, decodeMidi([0xb0, 18, 65]))).toBeNull();
  });

  it('keeps the right-column focus side buttons, NO tap-tempo', () => {
    const p = validateProfile(raw, 'mft.yaml');
    const kinds = p.controls.map((c) => c.action.kind);
    expect(kinds.filter((k) => k === 'focusStep')).toHaveLength(3);
    expect(kinds.filter((k) => (k as string) === 'tapTempo')).toHaveLength(0);
    // CC 10 on ch3 (side left-3) is left UNMAPPED — no control claims it.
    expect(p.controls.find((c) => c.match.type === 'cc' && c.match.channel === 3 && c.match.cc === 10)).toBeUndefined();
  });

  it('throws ProfileValidationError on nothing (all controls unique)', () => {
    expect(() => validateProfile(raw, 'mft.yaml')).not.toThrow(ProfileValidationError);
  });
});

// ── Sina's contract: bank 1 presents the IDENTICAL layout in BOTH contexts ──
// The profile is context-free (one flat controls list) BY DESIGN; these tests
// pin that fact so a future per-context split can't silently diverge the deck
// and mixer views of the hardware.
describe('shipped mft.yaml — deck and mixer contexts are IDENTICAL', () => {
  const raw = yaml.load(readFileSync(join(__dirname, '../../midi_profiles/mft.yaml'), 'utf8'));
  const p = validateProfile(raw, 'mft.yaml');

  it('every first-page event resolves to the SAME action in deck and mixer contexts', () => {
    const events: number[][] = [
      [0xb0, 0, 65], [0xb1, 0, 127], // speed turn + sync-toggle push
      [0xb0, 1, 65], [0xb1, 1, 127], // hue turn + hue-reset push
      [0xb0, 2, 65], [0xb1, 3, 127], // unassigned row-0 knobs (null in BOTH)
      [0xb0, 4, 65], [0xb1, 4, 127], // first local knob turn + reset push
      [0xb0, 15, 61], [0xb1, 15, 127], // last local knob
      [0xb3, 12, 127], // side button focus next
    ];
    for (const bytes of events) {
      expect(resolveEvent(p, decodeMidi(bytes), 'mixer')).toEqual(resolveEvent(p, decodeMidi(bytes), 'deck'));
    }
    // And the row-0 globals genuinely RESOLVE in the mixer context (the "global
    // row missing on the mixer" regression guard).
    expect(resolveEvent(p, decodeMidi([0xb0, 0, 65]), 'mixer')?.resolved).toMatchObject({ kind: 'paramCenterDelta', key: 'speed' });
    expect(resolveEvent(p, decodeMidi([0xb1, 0, 127]), 'mixer')?.resolved).toEqual({ kind: 'bpmSyncToggle' });
    expect(resolveEvent(p, decodeMidi([0xb0, 1, 65]), 'mixer')?.resolved).toMatchObject({ kind: 'globalHueDelta' });
    expect(resolveEvent(p, decodeMidi([0xb1, 1, 127]), 'mixer')?.resolved).toEqual({ kind: 'globalHueReset' });
  });

  it('LED projection paints byte-identical messages in deck and mixer contexts (red global row included)', () => {
    const state: MidiProjectionState = {
      blackout: false,
      activePattern: null,
      getGlobalEffectState: () => false,
      resolvePatternForBank: () => null,
      layerExists: () => true,
      getFocusedLayer: () => 0,
      isFocusLocked: () => false,
      getGlobalEffectSlotActive: () => false,
      globalEffectSlotCount: 0,
      getLayerPlaylistLength: () => 0,
      getLayerActiveEntryIndex: () => -1,
      getWindowCursor: () => 0,
      windowSize: 6,
      getColorPaletteHue: () => null,
      syncOwnedKeys: new Set<string>(),
      getFocusedExportValue: (i) => (i === 0 ? 0.5 : null),
      getGlobalParamValue: (k) => (k === 'speed' ? 0.5 : null),
      // Context-routed by the CALLER (manager) — the projector itself paints
      // whatever degrees this returns, identically in both contexts.
      getHueKnobDegrees: () => 0,
      getFocusedIdentityColor: () => 50, // a mixer-overlay identity (green) — same in both
      getFocusedExportModulated: () => false,
    };
    const deck = projectLeds(p, state, {}, 'deck');
    const mixer = projectLeds(p, state, {}, 'mixer');
    expect(mixer.messages).toEqual(deck.messages);
    // The RED global row is present in the MIXER paint: speed rest-red colour +
    // its half ring, hue red (0° tracks to RED 80) + empty ring.
    expect(mixer.messages).toContainEqual([0xb1, 0, 80]); // speed knob rest RED
    expect(mixer.messages).toContainEqual([0xb0, 0, 64]); // speed ring at 0.5
    expect(mixer.messages).toContainEqual([0xb1, 1, 80]); // hue at 0° = red
    // Focused local knob keeps its identity colour (kept per Sina — the mixer
    // colouring scheme stays) in BOTH contexts alike.
    expect(mixer.messages).toContainEqual([0xb1, 4, 50]);
    expect(deck.messages).toContainEqual([0xb1, 4, 50]);
  });
});
