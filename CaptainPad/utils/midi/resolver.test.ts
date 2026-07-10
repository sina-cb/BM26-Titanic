import { describe, it, expect } from 'vitest';
import { validateProfile } from './profile';
import {
  resolveEvent, profileClaims, UnknownContextError,
  RELATIVE_COUNT_CEILING,
} from './resolver';
import { decodeMidi } from './midi_message';

const profile = validateProfile({
  device: { id: 'apc', label: 'APC', nameContains: 'APC mini mk2', sourcePort: 0, destinationPort: 0 },
  controls: [
    { id: 'fader_1', match: { type: 'cc', channel: 0, cc: 48 }, action: { kind: 'paramCenter', key: 'speed', range: [0, 1] } },
    { id: 'master', match: { type: 'cc', channel: 0, cc: 56 }, action: { kind: 'master' } },
    { id: 'pads', match: { type: 'note', channel: 0, notes: [0, 7] }, action: { kind: 'patternBank', bank: 0 } },
    { id: 'blackout', match: { type: 'note', channel: 0, notes: [107] }, action: { kind: 'blackoutToggle' } },
  ],
});

describe('resolveEvent', () => {
  it('scales a CC paramCenter into its range and marks it continuous', () => {
    const r = resolveEvent(profile, decodeMidi([0xb0, 48, 127]));
    expect(r).toEqual({ controlId: 'fader_1', continuous: true, resolved: { kind: 'paramCenter', key: 'speed', value: 1 } });
  });

  it('scales a mid CC value', () => {
    const r = resolveEvent(profile, decodeMidi([0xb0, 48, 64]));
    expect(r?.resolved).toEqual({ kind: 'paramCenter', key: 'speed', value: 64 / 127 });
  });

  it('maps the master fader to 0..1', () => {
    const r = resolveEvent(profile, decodeMidi([0xb0, 56, 127]));
    expect(r?.resolved).toEqual({ kind: 'master', value: 1 });
  });

  it('resolves a pad to a patternBank index from the note offset', () => {
    const r = resolveEvent(profile, decodeMidi([0x90, 3, 127]));
    expect(r).toEqual({ controlId: 'pads', continuous: false, resolved: { kind: 'patternBank', bank: 0, index: 3 } });
  });

  it('resolves a button to a blackout toggle', () => {
    const r = resolveEvent(profile, decodeMidi([0x90, 107, 127]));
    expect(r?.resolved).toEqual({ kind: 'blackoutToggle' });
  });

  it('ignores Note Off (no momentary actions in v1)', () => {
    expect(resolveEvent(profile, decodeMidi([0x80, 107, 0]))).toBeNull();
    expect(resolveEvent(profile, decodeMidi([0x90, 3, 0]))).toBeNull();
  });

  it('returns null for unmapped messages', () => {
    expect(resolveEvent(profile, decodeMidi([0xb0, 99, 10]))).toBeNull();
    expect(resolveEvent(profile, decodeMidi([0x90, 40, 127]))).toBeNull();
  });
});

// A CC match with `anyChannel: true` binds the CC number across ALL channels —
// the VSN1 jog fix (the device emits CC 40 on channel = current page 0-3).
describe('resolveEvent — anyChannel CC match (VSN1 jog / moving-channel controls)', () => {
  const anyCh = validateProfile({
    device: { id: 'x', label: 'X', nameContains: 'X', sourcePort: 0, destinationPort: 0 },
    controls: [
      // Placeholder channel 0, but anyChannel means the compare ignores it.
      { id: 'jog', match: { type: 'cc', channel: 0, cc: 40, anyChannel: true }, action: { kind: 'effectIntensityAbs' } },
      // A channel-PINNED control for the contrast case.
      { id: 'pinned', match: { type: 'cc', channel: 0, cc: 48 }, action: { kind: 'master' } },
    ],
  });

  it('matches the CC on every channel 0..3 (the four effects pages)', () => {
    for (let ch = 0; ch < 4; ch += 1) {
      const r = resolveEvent(anyCh, decodeMidi([0xb0 | ch, 40, 100]));
      expect(r?.controlId).toBe('jog');
      expect(r?.resolved).toEqual({ kind: 'effectIntensityAbs', value: 100 / 127 });
    }
  });

  it('also matches on channels 4..15 (channel is not compared at all)', () => {
    for (const ch of [4, 7, 15]) {
      expect(resolveEvent(anyCh, decodeMidi([0xb0 | ch, 40, 64]))?.controlId).toBe('jog');
    }
  });

  it('still requires the CC NUMBER to match (anyChannel ≠ anyControl)', () => {
    expect(resolveEvent(anyCh, decodeMidi([0xb0, 41, 100]))).toBeNull();
    expect(resolveEvent(anyCh, decodeMidi([0xb3, 41, 100]))).toBeNull();
  });

  it('a channel-PINNED control still only matches its own channel', () => {
    expect(resolveEvent(anyCh, decodeMidi([0xb0, 48, 100]))?.controlId).toBe('pinned');
    expect(resolveEvent(anyCh, decodeMidi([0xb1, 48, 100]))).toBeNull(); // wrong channel → no match
  });
});

describe('profileClaims (learn-conflict rejection, 1.1)', () => {
  it('names the control a mapped CC / note resolves to', () => {
    expect(profileClaims(profile, { type: 'cc', channel: 0, number: 48 })).toBe('fader_1'); // speed
    expect(profileClaims(profile, { type: 'cc', channel: 0, number: 56 })).toBe('master');
    expect(profileClaims(profile, { type: 'note', channel: 0, number: 3 })).toBe('pads');
    expect(profileClaims(profile, { type: 'note', channel: 0, number: 107 })).toBe('blackout');
  });

  it('returns null for an unmapped control (free to learn)', () => {
    expect(profileClaims(profile, { type: 'cc', channel: 0, number: 51 })).toBeNull();
    expect(profileClaims(profile, { type: 'note', channel: 0, number: 40 })).toBeNull();
  });

  it('respects the active context', () => {
    const p = validateProfile({
      device: { id: 'apc', label: 'APC', nameContains: 'APC mini mk2', sourcePort: 0, destinationPort: 0 },
      contexts: {
        deck: [{ id: 'd_fader', match: { type: 'cc', channel: 0, cc: 54 }, action: { kind: 'paramCenter', key: 'speed', range: [0, 1] } }],
        mixer: [{ id: 'm_other', match: { type: 'cc', channel: 0, cc: 55 }, action: { kind: 'master' } }],
      },
    });
    // Mixer context doesn't map CC 54 → free there, but claimed on deck.
    expect(profileClaims(p, { type: 'cc', channel: 0, number: 54 }, 'deck')).toBe('d_fader');
    expect(profileClaims(p, { type: 'cc', channel: 0, number: 54 }, 'mixer')).toBeNull();
  });
});

// ── P3-7: an UNKNOWN context must FAIL LOUDLY, never silently fall back to the
// deck/default control list (which would mismap every control on that tab). ──
describe('resolveEvent — unknown context fails loud (P3-7)', () => {
  const p = validateProfile({
    device: { id: 'apc', label: 'APC', nameContains: 'APC mini mk2', sourcePort: 0, destinationPort: 0 },
    contexts: {
      deck: [{ id: 'd_fader', match: { type: 'cc', channel: 0, cc: 54 }, action: { kind: 'paramCenter', key: 'speed', range: [0, 1] } }],
      mixer: [{ id: 'm_other', match: { type: 'cc', channel: 0, cc: 55 }, action: { kind: 'master' } }],
    },
  });

  it('throws UnknownContextError naming the offending context', () => {
    expect(() => resolveEvent(p, decodeMidi([0xb0, 54, 127]), 'config'))
      .toThrow(UnknownContextError);
    expect(() => resolveEvent(p, decodeMidi([0xb0, 54, 127]), 'config'))
      .toThrow(/config/);
  });

  it('does NOT silently resolve the unknown context against the deck list', () => {
    // CC 54 is a real deck control; under the old `?? profile.controls` fallback
    // an unknown context would resolve it as if it were the deck tab.
    expect(() => resolveEvent(p, decodeMidi([0xb0, 54, 127]), 'config')).toThrow();
  });

  it('still resolves a known context, and the no-context path is unchanged', () => {
    expect(resolveEvent(p, decodeMidi([0xb0, 54, 127]), 'deck')?.controlId).toBe('d_fader');
    expect(resolveEvent(p, decodeMidi([0xb0, 54, 127]))?.controlId).toBe('d_fader'); // default fallback list
  });

  it('profileClaims also fails loud on an unknown context', () => {
    expect(() => profileClaims(p, { type: 'cc', channel: 0, number: 54 }, 'config'))
      .toThrow(UnknownContextError);
  });
});

describe('MFT relative encoders + side buttons (driver #2)', () => {
  // Bank-1 knob 0 = relative CC 0 on ch0 (turn) + CC 0 on ch1 (push); a bank-2
  // relative CC on ch0; the four side-button actions on ch3. The firmware
  // sends value = 64 + ticks × mult (mult ramps 1→17 with turn speed) — the
  // decoded count maps LINEARLY here: resolver raw delta = clamp(count, ±48
  // safety) × steps[0]. accel.ts applies the per-tick velocity gain downstream.
  const p = validateProfile({
    device: { id: 'mft', label: 'MFT', nameContains: 'Midi Fighter Twister', sourcePort: 0, destinationPort: 0, configureOnConnect: true },
    controls: [
      { id: 'knob0_turn', match: { type: 'cc', channel: 0, cc: 0, relative: true }, action: { kind: 'focusedParamKnob', index: 0 } },
      { id: 'knob0_push', match: { type: 'cc', channel: 1, cc: 0 }, action: { kind: 'focusedParamReset', index: 0 } },
      { id: 'g_speed', match: { type: 'cc', channel: 0, cc: 5, relative: true }, action: { kind: 'paramCenterRelative', key: 'speed', steps: [0.01, 0.05, 0.1] } },
      { id: 'sync_push', match: { type: 'cc', channel: 1, cc: 5 }, action: { kind: 'bpmSyncToggle' } },
      { id: 'hue_turn', match: { type: 'cc', channel: 0, cc: 6, relative: true }, action: { kind: 'hueKnob', steps: [0.01, 0.05, 0.1] } },
      { id: 'hue_push', match: { type: 'cc', channel: 1, cc: 6 }, action: { kind: 'hueReset' } },
      { id: 'f_prev', match: { type: 'cc', channel: 3, cc: 11 }, action: { kind: 'focusStep', dir: 'prev' } },
      { id: 'f_next', match: { type: 'cc', channel: 3, cc: 12 }, action: { kind: 'focusStep', dir: 'next' } },
      { id: 'f_deck', match: { type: 'cc', channel: 3, cc: 13 }, action: { kind: 'focusStep', dir: 'deck' } },
    ],
  });

  /** Raw travel of `count` firmware counts on a knob with base step `base` —
   *  mirrors resolver.relativeStep: LINEAR (count × base), with the SAFETY-only
   *  ceiling. The per-tick velocity gain lives in accel.ts, NOT here. */
  const eff = (count: number, base: number) =>
    Math.max(-RELATIVE_COUNT_CEILING, Math.min(RELATIVE_COUNT_CEILING, count)) * base;

  it('decodes a slow CW detent (code 65 = +1) to steps[0], continuous', () => {
    const r = resolveEvent(p, decodeMidi([0xb0, 0, 65]));
    expect(r).toEqual({ controlId: 'knob0_turn', continuous: true, resolved: { kind: 'focusedParamDelta', index: 0, delta: eff(1, 0.005) } });
  });

  it('decodes a −2 code (value 62) linearly in the count', () => {
    const r = resolveEvent(p, decodeMidi([0xb0, 0, 62]));
    expect(r?.resolved).toEqual({ kind: 'focusedParamDelta', index: 0, delta: eff(-2, 0.005) });
  });

  it('decodes a +3 code (value 67) linearly in the count', () => {
    const r = resolveEvent(p, decodeMidi([0xb0, 0, 67]));
    expect(r?.resolved).toEqual({ kind: 'focusedParamDelta', index: 0, delta: eff(3, 0.005) });
  });

  it('decodes a FAST-twist large code 1:1 — NO ±3 clamp (the fast-miss fix)', () => {
    // code 70 = +6: the old decoder returned null (movement DROPPED) and the
    // old step clamp capped |count| at 3; now it travels 6 counts' worth.
    expect(resolveEvent(p, decodeMidi([0xb0, 0, 70]))?.resolved)
      .toEqual({ kind: 'focusedParamDelta', index: 0, delta: eff(6, 0.005) });
    // The capture's saturated fast code (81 = +17, the firmware multiplier's
    // ceiling) resolves to the largest REAL single-message travel — FAR beyond
    // the old clamped ±3 value (3 × 0.005), well under the safety ceiling.
    const big = resolveEvent(p, decodeMidi([0xb0, 0, 81]))?.resolved as { delta: number };
    expect(big.delta).toBeCloseTo(eff(17, 0.005), 10);
    expect(big.delta).toBeGreaterThan(3 * 0.005);
  });

  it('caps a single message at RELATIVE_COUNT_CEILING counts (pure stray-code safety)', () => {
    // SAFETY ONLY: the firmware multiplier never exceeds 17 (encoders.c; live
    // capture max = 81 = +17), so the ceiling sits FAR above the real range and
    // never fires in normal use. A stray out-of-spec code still resolves (never
    // dropped) but cannot teleport the value past the ceiling's travel.
    const at63 = resolveEvent(p, decodeMidi([0xb0, 0, 127]))?.resolved as { delta: number }; // +63 → capped to +48
    expect(at63.delta).toBeCloseTo(eff(RELATIVE_COUNT_CEILING, 0.005), 10);
    const neg = resolveEvent(p, decodeMidi([0xb0, 0, 1]))?.resolved as { delta: number }; // −63 → capped to −48
    expect(neg.delta).toBeCloseTo(eff(-RELATIVE_COUNT_CEILING, 0.005), 10);
    // A real saturated fast twist (±17) is well under the cap — untouched.
    const real = resolveEvent(p, decodeMidi([0xb0, 0, 81]))?.resolved as { delta: number };
    expect(real.delta).toBeCloseTo(17 * 0.005, 10);
  });

  it('the no-movement code (64) still resolves to null (loud silence)', () => {
    expect(resolveEvent(p, decodeMidi([0xb0, 0, 64]))).toBeNull();
  });

  it('paramCenterRelative applies counts 1:1 on its own steps[0] + carries the key', () => {
    expect(resolveEvent(p, decodeMidi([0xb0, 5, 66]))?.resolved)
      .toEqual({ kind: 'paramCenterDelta', key: 'speed', delta: eff(2, 0.01) });
  });

  it('encoder push (ch1) resolves focusedParamReset on press, null on release', () => {
    expect(resolveEvent(p, decodeMidi([0xb1, 0, 127]))?.resolved).toEqual({ kind: 'focusedParamReset', index: 0 });
    expect(resolveEvent(p, decodeMidi([0xb1, 0, 0]))).toBeNull(); // release
  });

  // ── MFT UX v2 row-0 kinds ──
  it('bpmSyncToggle push resolves on press, null on release', () => {
    expect(resolveEvent(p, decodeMidi([0xb1, 5, 127]))?.resolved).toEqual({ kind: 'bpmSyncToggle' });
    expect(resolveEvent(p, decodeMidi([0xb1, 5, 0]))).toBeNull(); // release
  });

  it('hueKnob decodes relative ticks into hueDelta (1:1, continuous)', () => {
    expect(resolveEvent(p, decodeMidi([0xb0, 6, 65]))).toEqual({
      controlId: 'hue_turn', continuous: true,
      resolved: { kind: 'hueDelta', delta: eff(1, 0.01) },
    });
    expect(resolveEvent(p, decodeMidi([0xb0, 6, 61]))?.resolved).toEqual({ kind: 'hueDelta', delta: eff(-3, 0.01) });
    expect(resolveEvent(p, decodeMidi([0xb0, 6, 64]))).toBeNull(); // no-movement code — loud silence
  });

  it('relativeStep GROWS with |delta| up to the ceiling and is NEVER clamped to ±3', () => {
    // Same control, ascending codes up to the firmware ceiling (81 = +17): the
    // resolved magnitude must grow strictly — never plateau at 3·steps[0] the
    // way the old min(|d|,3) clamp did.
    const mags = [65, 66, 67, 68, 70, 74, 81].map((v) => {
      const r = resolveEvent(p, decodeMidi([0xb0, 0, v]))?.resolved as { delta: number };
      return r.delta;
    });
    for (let i = 1; i < mags.length; i += 1) expect(mags[i]).toBeGreaterThan(mags[i - 1]);
    // The largest is WAY beyond the old ±3 value (3·0.005 = 0.015).
    expect(mags[mags.length - 1]).toBeGreaterThan(2 * 0.015);
  });

  // ── Ground truth: literal sequences from the operator's live MIDI capture
  // (2026-07 discovery-tool session — slow twist vs fast flick, one knob each).
  // These assert the RESOLVER layer (decode → linear step, base = steps[0]);
  // accel.ts then multiplies a per-tick velocity gain downstream. The point
  // proven here is DECODE COVERAGE: every captured value resolves (nothing
  // dropped) and the magnitude tracks the count. ──
  describe('ground-truth capture sequences', () => {
    const deltaFor = (v: number): number => {
      const r = resolveEvent(p, decodeMidi([0xb0, 0, v]))?.resolved as { delta: number } | undefined;
      expect(r, `value ${v} must resolve — nothing dropped`).toBeDefined();
      return (r as { delta: number }).delta;
    };

    it('SLOW capture (stream of 65 = +1, ~60-1500 ms apart): every tick is one base step', () => {
      // 44 messages, all +1 — the operator's real slow twist. Each is one base
      // step (steps[0] = 0.005); all inside the old 61-67 window, which is why
      // slow "somewhat worked" before the fix.
      const steps = Array.from({ length: 44 }, () => deltaFor(65));
      for (const s of steps) expect(s).toBeCloseTo(0.005, 10);
      expect(steps.reduce((a, b) => a + b, 0)).toBeCloseTo(44 * 0.005, 10);
    });

    it('FAST capture (saturated 81 = +17 stream @ ~2-10 ms): every tick resolves — nothing dropped', () => {
      // A hard sustained spin is ~200+ msgs/s of value 81 = +17. The OLD decoder
      // returned null for 81 and dropped EVERY one of these — the fast-miss bug.
      // Now each resolves to +17 base steps (0.085), so even before the accel
      // gain a short burst already sweeps the range.
      const steps = Array.from({ length: 24 }, () => deltaFor(81));
      for (const s of steps) expect(s).toBeCloseTo(17 * 0.005, 10); // 0.085, none dropped
      expect(steps.reduce((a, b) => a + b, 0)).toBeGreaterThan(1.0);
    });

    it('MIXED real subsequence is monotonic positive with no dropped ticks', () => {
      // Literal values observed in the fast capture as the hand sped up.
      const observed = [65, 70, 81, 67, 74, 72, 68];
      const deltas = observed.map(deltaFor);
      for (const d of deltas) expect(d).toBeGreaterThan(0); // all CW, none dropped
      // Cumulative value climbs strictly monotonically.
      let acc = 0;
      for (const d of deltas) {
        const next = acc + d;
        expect(next).toBeGreaterThan(acc);
        acc = next;
      }
      expect(acc).toBeCloseTo((1 + 6 + 17 + 3 + 10 + 8 + 4) * 0.005, 10);
    });

    it('fast dwarfs slow at the decode layer: same message COUNT is 17× the travel', () => {
      const slow = Array.from({ length: 20 }, () => deltaFor(65)).reduce((a, b) => a + b, 0);
      const fast = Array.from({ length: 20 }, () => deltaFor(81)).reduce((a, b) => a + b, 0);
      expect(fast / slow).toBeCloseTo(17, 5);
    });
  });

  it('hueReset push resolves on press, null on release', () => {
    expect(resolveEvent(p, decodeMidi([0xb1, 6, 127]))?.resolved).toEqual({ kind: 'hueReset' });
    expect(resolveEvent(p, decodeMidi([0xb1, 6, 0]))).toBeNull(); // release
  });

  it('side buttons resolve focusStep on press, null on release', () => {
    expect(resolveEvent(p, decodeMidi([0xb3, 11, 127]))?.resolved).toEqual({ kind: 'focusStep', dir: 'prev' });
    expect(resolveEvent(p, decodeMidi([0xb3, 12, 127]))?.resolved).toEqual({ kind: 'focusStep', dir: 'next' });
    expect(resolveEvent(p, decodeMidi([0xb3, 13, 127]))?.resolved).toEqual({ kind: 'focusStep', dir: 'deck' });
    // CC 10 (side left-3) is intentionally UNMAPPED — tap-tempo is not wired.
    expect(resolveEvent(p, decodeMidi([0xb3, 10, 127]))).toBeNull();
    expect(resolveEvent(p, decodeMidi([0xb3, 11, 0]))).toBeNull(); // release
  });
});

describe('column matches (Stage 2)', () => {
  const p = validateProfile({
    device: { id: 'apc', label: 'APC', nameContains: 'APC mini mk2', sourcePort: 0, destinationPort: 0 },
    contexts: {
      mixer: [
        { id: 'win', match: { type: 'column', channel: 0, column: 2, fromRow: 1, toRow: 6 }, action: { kind: 'playlistWindowSelect', layer: 2 } },
        { id: 'pal', match: { type: 'column', channel: 0, column: 5, fromRow: 0, toRow: 7 }, action: { kind: 'colorPalettePair', bank: 1 } },
      ],
    },
  });

  it('resolves a column pad to its window slot (row - fromRow)', () => {
    // column 2, row 3 → note = 3*8 + 2 = 26; slot = 3 - 1 = 2
    expect(resolveEvent(p, decodeMidi([0x90, 26, 127]), 'mixer')?.resolved)
      .toEqual({ kind: 'playlistWindowSelect', layer: 2, slot: 2 });
  });

  it('colorPalettePair palette index = bank*8 + row', () => {
    // column 5, row 4 → note = 4*8 + 5 = 37; bank 1 → palette = 8 + 4 = 12
    expect(resolveEvent(p, decodeMidi([0x90, 37, 127]), 'mixer')?.resolved)
      .toEqual({ kind: 'colorPalettePair', palette: 12 });
  });

  it('ignores pads outside the column row range', () => {
    // column 2, row 0 (note 2) is below fromRow 1
    expect(resolveEvent(p, decodeMidi([0x90, 2, 127]), 'mixer')).toBeNull();
  });

  it('reverse: true flips the index so the TOP pad is slot 0', () => {
    const rp = validateProfile({
      device: { id: 'apc', label: 'APC', nameContains: 'APC mini mk2', sourcePort: 0, destinationPort: 0 },
      contexts: {
        mixer: [
          { id: 'win', match: { type: 'column', channel: 0, column: 0, fromRow: 1, toRow: 6, reverse: true }, action: { kind: 'playlistWindowSelect', layer: 0 } },
        ],
      },
    });
    // Top window pad = row 6 (note 48) → slot 0; bottom = row 1 (note 8) → slot 5.
    expect(resolveEvent(rp, decodeMidi([0x90, 48, 127]), 'mixer')?.resolved)
      .toEqual({ kind: 'playlistWindowSelect', layer: 0, slot: 0 });
    expect(resolveEvent(rp, decodeMidi([0x90, 8, 127]), 'mixer')?.resolved)
      .toEqual({ kind: 'playlistWindowSelect', layer: 0, slot: 5 });
  });
});
