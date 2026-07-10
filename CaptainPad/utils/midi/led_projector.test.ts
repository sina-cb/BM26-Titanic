import { describe, it, expect, vi } from 'vitest';
import { validateProfile } from './profile';
import { projectLeds, hueDegreesToMftWheel, MidiProjectionState, LedState } from './led_projector';
import { UnknownContextError } from './resolver';
import * as mftMessages from './mft/messages';
import * as midiMessage from './midi_message';

const profile = validateProfile({
  device: { id: 'apc', label: 'APC', nameContains: 'APC mini mk2', sourcePort: 0, destinationPort: 0 },
  controls: [
    { id: 'pads', match: { type: 'note', channel: 0, notes: [0, 3] }, action: { kind: 'patternBank', bank: 0 }, led: { active: 21, idle: 1, channel: 6 } },
    { id: 'blackout', match: { type: 'note', channel: 0, notes: [107] }, action: { kind: 'blackoutToggle' }, led: { on: 1, off: 0 } },
  ],
});

function state(over: Partial<MidiProjectionState> = {}): MidiProjectionState {
  return {
    blackout: false,
    activePattern: null,
    getCombinedAutopilotActive: () => false,
    getGlobalEffectState: () => false,
    resolvePatternForBank: () => null,
    layerExists: () => false,
    getFocusedLayer: () => -1,
    isFocusLocked: () => false,
    getGlobalEffectSlotActive: () => false,
    globalEffectSlotCount: 0,
    getLayerPlaylistLength: () => 0,
    getLayerActiveEntryIndex: () => -1,
    getWindowCursor: () => 0,
    windowSize: 6,
    getColorPaletteHue: () => null,
    syncOwnedKeys: new Set<string>(),
    ...over,
  };
}

describe('projectLeds', () => {
  it('lights the blackout button when blackout is on (single LED, channel 0)', () => {
    const { messages } = projectLeds(profile, state({ blackout: true }), {});
    expect(messages).toContainEqual([0x90, 107, 1]); // on
  });

  it('darkens the blackout button when blackout is off', () => {
    const { messages } = projectLeds(profile, state({ blackout: false }), {});
    expect(messages).toContainEqual([0x90, 107, 0]); // off
  });

  it('lights the active pattern pad green (channel 6) and others dim', () => {
    const s = state({
      activePattern: 'p2',
      resolvePatternForBank: (_b, i) => `p${i}`,
    });
    const { messages } = projectLeds(profile, s, {});
    expect(messages).toContainEqual([0x96, 2, 21]); // pad 2 active green, solid 100%
    expect(messages).toContainEqual([0x96, 0, 1]);  // pad 0 idle
  });

  it('keeps a pad with no pattern dark (velocity 0)', () => {
    const s = state({ activePattern: 'whatever', resolvePatternForBank: () => null });
    const { messages } = projectLeds(profile, s, {});
    expect(messages).toContainEqual([0x96, 0, 0]); // unlit — no pattern behind it
  });

  it('diffs: an unchanged projection sends nothing', () => {
    const s = state({ blackout: true });
    const first = projectLeds(profile, s, {});
    const second = projectLeds(profile, s, first.next);
    expect(second.messages).toEqual([]);
  });

  it('diffs: only the changed LED is re-sent', () => {
    const off = projectLeds(profile, state({ blackout: false }), {});
    const on = projectLeds(profile, state({ blackout: true }), off.next);
    expect(on.messages).toEqual([[0x90, 107, 1]]);
  });

  it('focusChannel track button lights only the focused layer', () => {
    const p = validateProfile({
      device: { id: 'apc', label: 'APC', nameContains: 'APC mini mk2', sourcePort: 0, destinationPort: 0 },
      contexts: {
        mixer: [
          { id: 't1', match: { type: 'note', channel: 0, notes: [100] }, action: { kind: 'focusChannel', layer: 0 }, led: { on: 1, off: 0 } },
          { id: 't2', match: { type: 'note', channel: 0, notes: [101] }, action: { kind: 'focusChannel', layer: 1 }, led: { on: 1, off: 0 } },
        ],
      },
    });
    const s = state({ layerExists: (l) => l <= 1, getFocusedLayer: () => 1 });
    const { messages } = projectLeds(p, s, {}, 'mixer');
    expect(messages).toContainEqual([0x90, 100, 0]); // layer 0 exists but not focused → off
    expect(messages).toContainEqual([0x90, 101, 1]); // layer 1 focused → lit
  });

  it('focusChannel track button BLINKS (flash velocity) while the focus is pickup-locked', () => {
    const p = validateProfile({
      device: { id: 'apc', label: 'APC', nameContains: 'APC mini mk2', sourcePort: 0, destinationPort: 0 },
      contexts: {
        mixer: [
          { id: 't1', match: { type: 'note', channel: 0, notes: [100] }, action: { kind: 'focusChannel', layer: 0 }, led: { on: 1, off: 0, flash: 2 } },
        ],
      },
    });
    // Focused + locked → blink velocity 2.
    const locked = projectLeds(p, state({ layerExists: (l) => l === 0, getFocusedLayer: () => 0, isFocusLocked: () => true }), {}, 'mixer');
    expect(locked.messages).toContainEqual([0x90, 100, 2]);
    // Focused + unlocked → solid on (velocity 1).
    const solid = projectLeds(p, state({ layerExists: (l) => l === 0, getFocusedLayer: () => 0, isFocusLocked: () => false }), {}, 'mixer');
    expect(solid.messages).toContainEqual([0x90, 100, 1]);
  });

  it('focusChannel flash falls back to `on` when the profile omits a flash velocity', () => {
    const p = validateProfile({
      device: { id: 'apc', label: 'APC', nameContains: 'APC mini mk2', sourcePort: 0, destinationPort: 0 },
      contexts: {
        mixer: [
          { id: 't1', match: { type: 'note', channel: 0, notes: [100] }, action: { kind: 'focusChannel', layer: 0 }, led: { on: 1, off: 0 } },
        ],
      },
    });
    const locked = projectLeds(p, state({ layerExists: (l) => l === 0, getFocusedLayer: () => 0, isFocusLocked: () => true }), {}, 'mixer');
    expect(locked.messages).toContainEqual([0x90, 100, 1]); // no flash → on
  });

  // ── P3-7: an unknown context must FAIL LOUDLY here too — otherwise the LED
  // projector would paint the deck list's LEDs on a tab that isn't the deck. ──
  it('throws UnknownContextError on an unknown context (P3-7), naming it', () => {
    const p = validateProfile({
      device: { id: 'apc', label: 'APC', nameContains: 'APC mini mk2', sourcePort: 0, destinationPort: 0 },
      contexts: {
        deck: [{ id: 't1', match: { type: 'note', channel: 0, notes: [100] }, action: { kind: 'blackoutToggle' }, led: { on: 1, off: 0 } }],
        mixer: [{ id: 't2', match: { type: 'note', channel: 0, notes: [101] }, action: { kind: 'blackoutToggle' }, led: { on: 1, off: 0 } }],
      },
    });
    expect(() => projectLeds(p, state({ blackout: true }), {}, 'nope')).toThrow(UnknownContextError);
    expect(() => projectLeds(p, state({ blackout: true }), {}, 'nope')).toThrow(/nope/);
  });

  it('still projects a known context and the no-context path unchanged (P3-7)', () => {
    const p = validateProfile({
      device: { id: 'apc', label: 'APC', nameContains: 'APC mini mk2', sourcePort: 0, destinationPort: 0 },
      contexts: {
        mixer: [{ id: 't1', match: { type: 'note', channel: 0, notes: [100] }, action: { kind: 'blackoutToggle' }, led: { on: 1, off: 0 } }],
      },
    });
    expect(projectLeds(p, state({ blackout: true }), {}, 'mixer').messages).toContainEqual([0x90, 100, 1]);
    // No context supplied → default control list, no throw.
    expect(projectLeds(p, state({ blackout: true }), {}).messages).toContainEqual([0x90, 100, 1]);
  });

  it('colour-pair pads show c1 on even columns and c2 on odd (Stage 2)', () => {
    const p = validateProfile({
      device: { id: 'apc', label: 'APC', nameContains: 'APC mini mk2', sourcePort: 0, destinationPort: 0 },
      contexts: {
        mixer: [
          { id: 'c1col', match: { type: 'column', channel: 0, column: 4, fromRow: 0, toRow: 0 }, action: { kind: 'colorPalettePair', bank: 0 } },
          { id: 'c2col', match: { type: 'column', channel: 0, column: 5, fromRow: 0, toRow: 0 }, action: { kind: 'colorPalettePair', bank: 0 } },
        ],
      },
    });
    const s = state({ getColorPaletteHue: (i) => (i === 0 ? { c1: 0.0, c2: 0.33 } : null) });
    const { messages } = projectLeds(p, s, {}, 'mixer');
    expect(messages).toContainEqual([0x96, 4, 5]);  // col4 (even) → c1 hue 0.0 → red
    expect(messages).toContainEqual([0x96, 5, 21]); // col5 (odd)  → c2 hue 0.33 → green
  });
});

describe('projectLeds — MFT rings (driver #2, best-effort)', () => {
  const mft = validateProfile({
    device: { id: 'mft', label: 'MFT', nameContains: 'Midi Fighter Twister', sourcePort: 0, destinationPort: 0 },
    controls: [
      { id: 'k0', match: { type: 'cc', channel: 0, cc: 0, relative: true }, action: { kind: 'focusedParamKnob', index: 0 } },
      { id: 'k1', match: { type: 'cc', channel: 0, cc: 1, relative: true }, action: { kind: 'focusedParamKnob', index: 1 } },
    ],
  });

  it('emits a ring-value CC (ch0) from the focused export value 0..127', () => {
    const s = state({
      getFocusedExportValue: (i) => (i === 0 ? 1.0 : i === 1 ? 0.5 : null),
      getFocusedIdentityColor: () => 1, // blue (deck)
    });
    const { messages } = projectLeds(mft, s, {});
    expect(messages).toContainEqual([0xb0, 0, 127]); // knob 0 ring full
    expect(messages).toContainEqual([0xb0, 1, 64]);  // knob 1 ring ~half (round(0.5*127))
  });

  it('emits the focused identity colour on a knob with a param behind it', () => {
    const s = state({ getFocusedExportValue: (i) => (i === 0 ? 0.25 : null), getFocusedIdentityColor: () => 50 });
    const { messages } = projectLeds(mft, s, {});
    expect(messages).toContainEqual([0xb1, 0, 50]); // colour CC on ch1 (SWITCH_AND_COLOR)
  });

  it('darks a knob with no param behind it (ring 0 + inactive colour)', () => {
    const s = state({ getFocusedExportValue: () => null, getFocusedIdentityColor: () => 1 });
    const { messages } = projectLeds(mft, s, {});
    expect(messages).toContainEqual([0xb0, 0, 0]);  // ring off
    expect(messages).toContainEqual([0xb1, 0, 0]);  // inactive colour (ColorValues.INACTIVE)
  });

  it('diffs rings — an unchanged value re-sends nothing', () => {
    const s = state({ getFocusedExportValue: (i) => (i === 0 ? 0.5 : null), getFocusedIdentityColor: () => 1 });
    const first = projectLeds(mft, s, {});
    const second = projectLeds(mft, s, first.next);
    expect(second.messages).toHaveLength(0);
  });

  it('is inert on a projection state without the MFT getters (APC-only path)', () => {
    const { messages } = projectLeds(mft, state(), {});
    // No getFocusedExportValue → ringMessages yields nothing; no led specs either.
    expect(messages).toHaveLength(0);
  });

  // ── Task 4a: a modulated focused param PULSES its ring ──
  it('emits a RGB_PULSE_1_BEAT animation (ch2) for a modulated focused param', () => {
    const s = state({
      getFocusedExportValue: (i) => (i === 0 ? 0.5 : null),
      getFocusedIdentityColor: () => 1,
      getFocusedExportModulated: (i) => i === 0, // knob 0 modulated
    });
    const { messages } = projectLeds(mft, s, {});
    // Animation CC is on the ANIMATIONS_AND_BRIGHTNESS channel (2) at the encoder
    // index; RGB_PULSE_1_BEAT = 13.
    expect(messages).toContainEqual([0xb2, 0, 13]);
  });

  it('emits NONE (steady) for an UNmodulated focused param', () => {
    const s = state({
      getFocusedExportValue: (i) => (i === 0 ? 0.5 : null),
      getFocusedIdentityColor: () => 1,
      getFocusedExportModulated: () => false,
    });
    const { messages } = projectLeds(mft, s, {});
    expect(messages).toContainEqual([0xb2, 0, 0]); // AnimationValues.NONE
  });

  // ── MFT UX v2: encoder number comes from the MATCH CC, not the action index ──
  it('an OFFSET local knob (cc 4 → export 0) paints encoder 4, not encoder 0', () => {
    const offset = validateProfile({
      device: { id: 'mft', label: 'MFT', nameContains: 'Midi Fighter Twister', sourcePort: 0, destinationPort: 0 },
      controls: [
        { id: 'k4', match: { type: 'cc', channel: 0, cc: 4, relative: true }, action: { kind: 'focusedParamKnob', index: 0 } },
      ],
    });
    const s = state({ getFocusedExportValue: (i) => (i === 0 ? 1.0 : null), getFocusedIdentityColor: () => 1 });
    const { messages } = projectLeds(offset, s, {});
    expect(messages).toContainEqual([0xb0, 4, 127]); // ring on ENCODER 4
    expect(messages).toContainEqual([0xb1, 4, 1]);   // colour on ENCODER 4
    expect(messages.find((m) => m[0] === 0xb0 && m[1] === 0)).toBeUndefined(); // nothing on encoder 0
  });

  // ── MFT UX v2: sync cue is a SOLID colour (green), replacing the old strobe ──
  const mftGlobal = validateProfile({
    device: { id: 'mft', label: 'MFT', nameContains: 'Midi Fighter Twister', sourcePort: 0, destinationPort: 0 },
    controls: [
      { id: 'g_speed', match: { type: 'cc', channel: 0, cc: 0, relative: true }, action: { kind: 'paramCenterRelative', key: 'speed' }, led: { on: 50, off: 80 } },
    ],
  });

  it('speed knob turns SOLID GREEN (led.on) when syncOwnedKeys owns speed — no strobe (#4/I4 + v2)', () => {
    const s = state({
      getGlobalParamValue: (k) => (k === 'speed' ? 0.5 : null),
      syncOwnedKeys: new Set(['speed']),
    });
    const { messages } = projectLeds(mftGlobal, s, {});
    expect(messages).toContainEqual([0xb0, 0, 64]); // ring at 0.5
    expect(messages).toContainEqual([0xb1, 0, 50]); // SOLID GREEN
    expect(messages).toContainEqual([0xb2, 0, 0]);  // animation pinned to NONE (strobe replaced)
    expect(messages).not.toContainEqual([0xb2, 0, 4]); // the old strobe must be gone
  });

  it('speed knob rests RED (led.off) when sync is not engaged', () => {
    const s = state({
      getGlobalParamValue: (k) => (k === 'speed' ? 0.5 : null),
      syncOwnedKeys: new Set<string>(),
    });
    const { messages } = projectLeds(mftGlobal, s, {});
    expect(messages).toContainEqual([0xb1, 0, 80]); // rest RED
    expect(messages).toContainEqual([0xb2, 0, 0]);
  });

  it('reads syncOwnedKeys by the ACTUAL key — not a hardcoded speed literal (#4/I4)', () => {
    // A profile whose relative knob drives `size`; if the projector still keyed
    // the cue on the 'speed' literal this would never go green. It must show
    // led.on when `size` is owned and led.off when it is not.
    const mftSize = validateProfile({
      device: { id: 'mft', label: 'MFT', nameContains: 'Midi Fighter Twister', sourcePort: 0, destinationPort: 0 },
      controls: [
        { id: 'g_size', match: { type: 'cc', channel: 0, cc: 17, relative: true }, action: { kind: 'paramCenterRelative', key: 'size' }, led: { on: 50, off: 80 } },
      ],
    });
    const owned = projectLeds(mftSize, state({ getGlobalParamValue: (k) => (k === 'size' ? 0.5 : null), syncOwnedKeys: new Set(['size']) }), {});
    expect(owned.messages).toContainEqual([0xb1, 17, 50]); // green — size is owned
    const free = projectLeds(mftSize, state({ getGlobalParamValue: (k) => (k === 'size' ? 0.5 : null), syncOwnedKeys: new Set(['speed']) }), {});
    expect(free.messages).toContainEqual([0xb1, 17, 80]); // rest — only speed owned, not size
  });

  it('a paramCenterRelative WITHOUT an led spec emits no colour (configured inactive colour shows)', () => {
    const bare = validateProfile({
      device: { id: 'mft', label: 'MFT', nameContains: 'Midi Fighter Twister', sourcePort: 0, destinationPort: 0 },
      controls: [
        { id: 'g_speed', match: { type: 'cc', channel: 0, cc: 0, relative: true }, action: { kind: 'paramCenterRelative', key: 'speed' } },
      ],
    });
    const { messages } = projectLeds(bare, state({ getGlobalParamValue: () => 0.5, syncOwnedKeys: new Set(['speed']) }), {});
    expect(messages.find((m) => m[0] === 0xb1)).toBeUndefined(); // no colour writes
  });

  // ── The APC LED path stays byte-identical (no animation/ring bytes leak in) ──
  it('emits NO MFT ring/animation CCs on the APC pad profile', () => {
    const s = state({
      blackout: true,
      // Even with all MFT getters present, an APC-only profile has no
      // focusedParamKnob/paramCenterRelative controls → no ring/anim messages.
      getFocusedExportValue: () => 0.5,
      getFocusedExportModulated: () => true,
      getGlobalParamValue: () => 0.5,
      syncOwnedKeys: new Set(['speed']),
    });
    const { messages } = projectLeds(profile, s, {});
    // Only the APC note messages (status 0x90); no CC (0xb0/0xb1/0xb2) anywhere.
    for (const m of messages) expect(m[0] & 0xf0).toBe(0x90);
  });
});

// ── MFT UX v2: the hue knob's ring + colour track the GLOBAL hue ─────────────
describe('hueDegreesToMftWheel (anchor points)', () => {
  it('hits the known colour-wheel anchors exactly', () => {
    expect(hueDegreesToMftWheel(0)).toBe(80);    // red
    expect(hueDegreesToMftWheel(60)).toBe(64);   // yellow
    expect(hueDegreesToMftWheel(120)).toBe(50);  // green
    expect(hueDegreesToMftWheel(240)).toBe(1);   // blue
    expect(hueDegreesToMftWheel(300)).toBe(100); // pink (wrapped past 125/126)
    expect(hueDegreesToMftWheel(360)).toBe(80);  // full circle → red again
  });

  it('interpolates smoothly and stays within the device colour range [1, 126]', () => {
    expect(hueDegreesToMftWheel(30)).toBe(72);   // midway red→yellow
    expect(hueDegreesToMftWheel(180)).toBe(26);  // midway green→blue (cyan-ish)
    for (let d = 0; d < 360; d += 5) {
      const v = hueDegreesToMftWheel(d);
      expect(v).toBeGreaterThanOrEqual(1);
      expect(v).toBeLessThanOrEqual(126);
    }
  });

  it('normalises out-of-range degrees (wrap, negative)', () => {
    expect(hueDegreesToMftWheel(720)).toBe(80);
    expect(hueDegreesToMftWheel(-60)).toBe(hueDegreesToMftWheel(300));
  });
});

describe('projectLeds — MFT UX v2 hue knob', () => {
  const hueProfile = validateProfile({
    device: { id: 'mft', label: 'MFT', nameContains: 'Midi Fighter Twister', sourcePort: 0, destinationPort: 0 },
    controls: [
      { id: 'g_hue', match: { type: 'cc', channel: 0, cc: 1, relative: true }, action: { kind: 'hueKnob' }, led: { off: 80 } },
    ],
  });

  it('ring = degrees/360, colour tracks the hue wheel, animation NONE', () => {
    const { messages } = projectLeds(hueProfile, state({ getHueKnobDegrees: () => 120 }), {});
    expect(messages).toContainEqual([0xb0, 1, Math.round((120 / 360) * 127)]); // ring third
    expect(messages).toContainEqual([0xb1, 1, 50]); // 120° = green
    expect(messages).toContainEqual([0xb2, 1, 0]);  // steady
  });

  it('at 0° the knob shows RED with an empty ring', () => {
    const { messages } = projectLeds(hueProfile, state({ getHueKnobDegrees: () => 0 }), {});
    expect(messages).toContainEqual([0xb0, 1, 0]);
    expect(messages).toContainEqual([0xb1, 1, 80]);
  });

  it('colour FOLLOWS a hue change (diff emits the new wheel value)', () => {
    const first = projectLeds(hueProfile, state({ getHueKnobDegrees: () => 0 }), {});
    const second = projectLeds(hueProfile, state({ getHueKnobDegrees: () => 240 }), first.next);
    expect(second.messages).toContainEqual([0xb1, 1, 1]); // now blue
  });

  it('hue state not loaded (null) → ring 0 + rest colour (led.off)', () => {
    const { messages } = projectLeds(hueProfile, state({ getHueKnobDegrees: () => null }), {});
    expect(messages).toContainEqual([0xb0, 1, 0]);
    expect(messages).toContainEqual([0xb1, 1, 80]); // rest red, never a fabricated hue
  });

  it('is inert on a projection state without the hue getter (APC-only path)', () => {
    const { messages } = projectLeds(hueProfile, state(), {});
    expect(messages).toHaveLength(0);
  });
});

// ── #9 orphaned-LED off: keys that VANISH from the projected set get an off ──
describe('projectLeds — #9 orphaned-LED off', () => {
  const mft = validateProfile({
    device: { id: 'mft', label: 'MFT', nameContains: 'Midi Fighter Twister', sourcePort: 0, destinationPort: 0 },
    controls: [
      { id: 'k0', match: { type: 'cc', channel: 0, cc: 0, relative: true }, action: { kind: 'focusedParamKnob', index: 0 } },
    ],
  });

  it('emits an off for a note key present in prev but absent from next (APC)', () => {
    // Frame 1 lights the blackout note (107) on.
    const first = projectLeds(profile, state({ blackout: true }), {});
    expect(first.next['144:107']).toBe('1'); // 0x90 = 144, note 107, on
    // Frame 2 projects an EMPTY profile (the key set shrank to nothing). The lit
    // note vanishes from `next` → must get an explicit off.
    const empty = validateProfile({
      device: { id: 'apc', label: 'APC', nameContains: 'APC mini mk2', sourcePort: 0, destinationPort: 0 },
      controls: [{ id: 'nop', match: { type: 'cc', channel: 0, cc: 60 }, action: { kind: 'master' } }],
    });
    const second = projectLeds(empty, state({ blackout: true }), first.next);
    expect(second.messages).toContainEqual([0x90, 107, 0]); // note-off for the orphan
    expect(second.next['144:107']).toBe('0');
  });

  it('emits a CC 0 (ring clear) for an MFT ring key that vanishes', () => {
    // Frame 1 lights knob-0 ring + colour + animation.
    const s = state({ getFocusedExportValue: (i) => (i === 0 ? 1.0 : null), getFocusedIdentityColor: () => 1 });
    const first = projectLeds(mft, s, {});
    expect(first.next['176:0']).toBe('127'); // 0xb0 ring full
    // Frame 2: a profile with NO ring controls → the ring/colour/anim keys vanish.
    const noRings = validateProfile({
      device: { id: 'mft', label: 'MFT', nameContains: 'Midi Fighter Twister', sourcePort: 0, destinationPort: 0 },
      controls: [{ id: 'push', match: { type: 'cc', channel: 1, cc: 5 }, action: { kind: 'focusedParamReset', index: 5 } }],
    });
    const second = projectLeds(noRings, s, first.next);
    expect(second.messages).toContainEqual([0xb0, 0, 0]); // ring cleared
    expect(second.messages).toContainEqual([0xb1, 0, 0]); // colour cleared (0xb1)
  });

  it('does NOT re-emit an off for a key that was already dark (0) in prev', () => {
    // prev has a note already at 0 and one at 1; only the lit one that vanishes
    // should get an off — the dark one is noise-free.
    const prev: LedState = { '144:50': '0', '144:51': '1' };
    const empty = validateProfile({
      device: { id: 'apc', label: 'APC', nameContains: 'APC mini mk2', sourcePort: 0, destinationPort: 0 },
      controls: [{ id: 'nop', match: { type: 'cc', channel: 0, cc: 60 }, action: { kind: 'master' } }],
    });
    const { messages } = projectLeds(empty, state(), prev);
    expect(messages).toContainEqual([0x90, 51, 0]); // the lit orphan → off
    expect(messages).not.toContainEqual([0x90, 50, 0]); // the already-dark one → no noise
  });
});

// ── 12c diff-before-construct: no MIDI array is built on the no-change path ──
describe('projectLeds — 12c diff before construct (lazy allocation)', () => {
  const mft = validateProfile({
    device: { id: 'mft', label: 'MFT', nameContains: 'Midi Fighter Twister', sourcePort: 0, destinationPort: 0 },
    controls: [
      { id: 'k0', match: { type: 'cc', channel: 0, cc: 0, relative: true }, action: { kind: 'focusedParamKnob', index: 0 } },
    ],
  });

  it('constructs ZERO messages (no noteOn build) when an APC projection is unchanged', () => {
    const s = state({ blackout: true, activePattern: 'p2', resolvePatternForBank: (_b, i) => `p${i}` });
    const first = projectLeds(profile, s, {});
    const noteOnSpy = vi.spyOn(midiMessage, 'noteOn');
    const second = projectLeds(profile, s, first.next);
    expect(second.messages).toHaveLength(0);
    expect(noteOnSpy).not.toHaveBeenCalled(); // nothing changed → nothing built
    noteOnSpy.mockRestore();
  });

  it('constructs ZERO ring/colour/anim messages when an MFT projection is unchanged', () => {
    const s = state({ getFocusedExportValue: (i) => (i === 0 ? 0.5 : null), getFocusedIdentityColor: () => 1 });
    const first = projectLeds(mft, s, {});
    const ringSpy = vi.spyOn(mftMessages, 'setRingValue');
    const colorSpy = vi.spyOn(mftMessages, 'setColor');
    const animSpy = vi.spyOn(mftMessages, 'setAnimation');
    const second = projectLeds(mft, s, first.next);
    expect(second.messages).toHaveLength(0);
    expect(ringSpy).not.toHaveBeenCalled();
    expect(colorSpy).not.toHaveBeenCalled();
    expect(animSpy).not.toHaveBeenCalled();
    ringSpy.mockRestore(); colorSpy.mockRestore(); animSpy.mockRestore();
  });

  it('builds ONLY the changed message on a partial change (identical output to before)', () => {
    // Two knobs; move only knob 1. Knob 0 must not be rebuilt, and the single
    // emitted message must equal the full-projection message for knob 1.
    const mft2 = validateProfile({
      device: { id: 'mft', label: 'MFT', nameContains: 'Midi Fighter Twister', sourcePort: 0, destinationPort: 0 },
      controls: [
        { id: 'k0', match: { type: 'cc', channel: 0, cc: 0, relative: true }, action: { kind: 'focusedParamKnob', index: 0 } },
        { id: 'k1', match: { type: 'cc', channel: 0, cc: 1, relative: true }, action: { kind: 'focusedParamKnob', index: 1 } },
      ],
    });
    const before = state({ getFocusedExportValue: (i) => (i === 0 ? 0.5 : i === 1 ? 0.5 : null), getFocusedIdentityColor: () => 1 });
    const first = projectLeds(mft2, before, {});
    const after = state({ getFocusedExportValue: (i) => (i === 0 ? 0.5 : i === 1 ? 1.0 : null), getFocusedIdentityColor: () => 1 });
    const ringSpy = vi.spyOn(mftMessages, 'setRingValue');
    const second = projectLeds(mft2, after, first.next);
    // Knob 1's ring changed 0.5→1.0; knob 0 unchanged. Ring build fires once.
    expect(second.messages).toContainEqual([0xb0, 1, 127]); // knob 1 → full
    expect(ringSpy).toHaveBeenCalledTimes(1);
    expect(ringSpy).toHaveBeenCalledWith(1, 127);
    ringSpy.mockRestore();
    // Output identical to a full fresh projection's knob-1 ring value.
    const fresh = projectLeds(mft2, after, {});
    expect(fresh.messages).toContainEqual([0xb0, 1, 127]);
  });
});
