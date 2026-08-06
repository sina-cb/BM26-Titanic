// Unit tests for the TOUCH CONTROL tab's pure logic.
//
// Picked up by the default vitest run via the `components/**/*.test.ts` glob
// in vitest.config.ts (`.agent/os/testing.md`: prove the file runs by watching
// the suite count go up). Everything under test is RN-free by construction.

import { describe, it, expect, vi } from 'vitest';
import {
  CPC,
  PAD_AXES,
  TOUCH_CONTROL_ORIGIN,
  clamp01,
  positionToUnit,
  unitToPosition,
  flipY,
  hsvToRgb,
  hsvToCss,
  hueDegrees,
  unitPercent,
  isHsv,
  asFiniteNumber,
  createSendGate,
  sharedParamMessage,
  isParamRejected,
  describeRejection,
  numbersConverged,
  hsvConverged,
  colorKeysFor,
  slotsFor,
  rotateHue,
  uniformPalette,
  complementaryPalette,
  contrastingPalette,
  monochromePalette,
  minHueSeparationDeg,
  MIN_HUE_SEPARATION_DEG,
  hsvToColor6,
  effectTakesColor,
  isEngineBackedSlot,
  COLOR_SLOT_COUNT,
  COLOR_SLOTS,
  PAINT_ZONES,
  paintZoneFor,
  paintPayload,
  allPaintedGroups,
  findExportId,
  patternHueControlFor,
  cycleStepMs,
  cyclePairAt,
  cycleSoloAt,
  rotatedColorFor,
  rotationAt,
  CYCLE_MIN_STEP_MS,
  findSlotFor,
  firstFreeSlotId,
  isEffectActive,
  paramsMatch,
  activeTracer,
  padZToSweepHz,
  SWEEP_HZ_MIN,
  SWEEP_HZ_MAX,
  clampBrightness,
  padXToBrightness,
  brightnessToPadX,
  MIN_BRIGHTNESS,
  TOUCH_EFFECTS,
  PROVISION_MIN_SLOT_ID,
  MAX_SLOT_ID,
  isBpmSyncOn,
  BPM_SYNC_ON,
  BPM_SYNC_OFF,
  BPM_SYNC_THRESHOLD,
  CONVERGE_EPSILON,
  OVERRIDE_WATCHDOG_MS,
  CPC_SEND_INTERVAL_MS,
  COLOR_FADE_MIN_MS,
  COLOR_FADE_MAX_MS,
} from './touch_control_logic';

describe('clamp01', () => {
  it('passes through in-range values', () => {
    expect(clamp01(0)).toBe(0);
    expect(clamp01(0.5)).toBe(0.5);
    expect(clamp01(1)).toBe(1);
  });

  it('clamps out-of-range values to the unit interval', () => {
    expect(clamp01(-3)).toBe(0);
    expect(clamp01(42)).toBe(1);
  });

  // Codex P0 — fail loud. A NaN must never become a silent 0 that blacks out
  // or snaps the rig; it means the caller measured nothing.
  it('THROWS on non-finite input rather than coercing', () => {
    expect(() => clamp01(NaN)).toThrow(/finite/);
    expect(() => clamp01(Infinity)).toThrow(/finite/);
    expect(() => clamp01(-Infinity)).toThrow(/finite/);
    // @ts-expect-error — deliberately wrong type at the boundary
    expect(() => clamp01('0.5')).toThrow(/finite/);
    // @ts-expect-error — deliberately wrong type at the boundary
    expect(() => clamp01(undefined)).toThrow(/finite/);
  });
});

describe('positionToUnit', () => {
  it('maps a position within a measured size onto [0,1]', () => {
    expect(positionToUnit(0, 200)).toBe(0);
    expect(positionToUnit(100, 200)).toBe(0.5);
    expect(positionToUnit(200, 200)).toBe(1);
  });

  it('clamps a drag that leaves the pad instead of throwing', () => {
    expect(positionToUnit(-50, 200)).toBe(0);
    expect(positionToUnit(999, 200)).toBe(1);
  });

  // "Not measured yet" is a real transient state (pre-onLayout), NOT an error
  // and NOT a silent 0 — the caller must skip the write for that frame.
  it('returns null when the view has no usable measurement', () => {
    expect(positionToUnit(10, 0)).toBeNull();
    expect(positionToUnit(10, -1)).toBeNull();
    expect(positionToUnit(10, NaN)).toBeNull();
  });

  it('returns null for a non-finite position', () => {
    expect(positionToUnit(NaN, 200)).toBeNull();
  });
});

describe('unitToPosition', () => {
  it('is the inverse of positionToUnit for a measured size', () => {
    expect(unitToPosition(0.25, 400)).toBe(100);
    expect(unitToPosition(positionToUnit(150, 300) as number, 300)).toBe(150);
  });

  it('collapses to 0 when unmeasured (nothing to place yet)', () => {
    expect(unitToPosition(0.5, 0)).toBe(0);
  });
});

describe('flipY', () => {
  it('turns screen-down into operator-up exactly once', () => {
    expect(flipY(0)).toBe(1);
    expect(flipY(1)).toBe(0);
    expect(flipY(0.25)).toBe(0.75);
  });
});

describe('hsvToRgb', () => {
  it('produces the primaries at their hue sectors, full S and V', () => {
    expect(hsvToRgb(0, 1, 1)).toEqual({ r: 1, g: 0, b: 0 });
    expect(hsvToRgb(1 / 3, 1, 1)).toEqual({ r: 0, g: 1, b: 0 });
    expect(hsvToRgb(2 / 3, 1, 1)).toEqual({ r: 0, g: 0, b: 1 });
  });

  it('is greyscale at zero saturation and black at zero value', () => {
    expect(hsvToRgb(0.42, 0, 1)).toEqual({ r: 1, g: 1, b: 1 });
    expect(hsvToRgb(0.42, 1, 0)).toEqual({ r: 0, g: 0, b: 0 });
  });

  it('renders a CSS rgb() string for a React Native backgroundColor', () => {
    expect(hsvToCss(0, 1, 1)).toBe('rgb(255, 0, 0)');
    expect(hsvToCss(2 / 3, 1, 1)).toBe('rgb(0, 0, 255)');
  });
});

describe('readouts', () => {
  it('renders hue in whole degrees around the wheel', () => {
    expect(hueDegrees(0)).toBe(0);
    expect(hueDegrees(0.5)).toBe(180);
    expect(hueDegrees(1)).toBe(360);
  });

  it('renders unit values as whole percents', () => {
    expect(unitPercent(0)).toBe(0);
    expect(unitPercent(0.507)).toBe(51);
    expect(unitPercent(1)).toBe(100);
  });
});

describe('engine value guards', () => {
  it('accepts a well-formed HSV triple', () => {
    expect(isHsv({ h: 0.64, s: 1, v: 1 })).toBe(true);
  });

  it('rejects malformed or absent palette slots', () => {
    expect(isHsv(null)).toBe(false);
    expect(isHsv(undefined)).toBe(false);
    expect(isHsv({ h: 0.5, s: 1 })).toBe(false);
    expect(isHsv({ h: 'red', s: 1, v: 1 })).toBe(false);
    expect(isHsv({ h: NaN, s: 1, v: 1 })).toBe(false);
    expect(isHsv(0.5)).toBe(false);
  });

  // Black (h0 s0 v0) is a REAL color an operator can set, so it must not
  // double as the "missing" sentinel.
  it('treats pure black as a real value, not as missing', () => {
    expect(isHsv({ h: 0, s: 0, v: 0 })).toBe(true);
  });

  it('reads finite numbers and reports anything else as unknown', () => {
    expect(asFiniteNumber(0)).toBe(0);
    expect(asFiniteNumber(0.42)).toBe(0.42);
    expect(asFiniteNumber(NaN)).toBeNull();
    expect(asFiniteNumber('1')).toBeNull();
    expect(asFiniteNumber(undefined)).toBeNull();
    expect(asFiniteNumber(null)).toBeNull();
  });
});

describe('createSendGate', () => {
  it('allows the first send immediately', () => {
    const gate = createSendGate(33, () => 0);
    expect(gate.allow()).toBe(true);
  });

  it('suppresses sends inside the interval and reopens after it', () => {
    let t = 1000;
    const gate = createSendGate(100, () => t);
    expect(gate.allow()).toBe(true); // t=1000
    t = 1050;
    expect(gate.allow()).toBe(false); // too soon
    t = 1099;
    expect(gate.allow()).toBe(false);
    t = 1100;
    expect(gate.allow()).toBe(true); // exactly at the boundary
    t = 1150;
    expect(gate.allow()).toBe(false);
  });

  it('reopens immediately after reset (drag start must never be dropped)', () => {
    let t = 500;
    const gate = createSendGate(100, () => t);
    expect(gate.allow()).toBe(true);
    expect(gate.allow()).toBe(false);
    gate.reset();
    expect(gate.allow()).toBe(true);
  });

  it('with a zero interval never suppresses', () => {
    let t = 0;
    const gate = createSendGate(0, () => t);
    expect(gate.allow()).toBe(true);
    expect(gate.allow()).toBe(true);
  });

  it('rejects a nonsensical interval loudly', () => {
    expect(() => createSendGate(-1)).toThrow(/non-negative/);
    expect(() => createSendGate(NaN)).toThrow(/non-negative/);
  });

  it('defaults to a real clock when none is injected', () => {
    const spy = vi.spyOn(Date, 'now').mockReturnValue(12345);
    const gate = createSendGate(50);
    expect(gate.allow()).toBe(true);
    expect(gate.allow()).toBe(false);
    spy.mockRestore();
  });
});

describe('sharedParamMessage', () => {
  // Wire shape verified against marsin_engine/lib/api_server.js:
  //   d.type === 'setSharedParam' → paramCenter.set(d.key, d.value, 'ws', d.origin)
  it('builds the exact envelope the engine WS handler destructures', () => {
    expect(sharedParamMessage(CPC.SIZE, 0.5)).toEqual({
      type: 'setSharedParam',
      key: 'size',
      value: 0.5,
      origin: TOUCH_CONTROL_ORIGIN,
    });
  });

  it('carries an HSV object through unchanged for the palette keys', () => {
    const value = { h: 0.25, s: 1, v: 1 };
    expect(sharedParamMessage(CPC.COLOR_1, value)).toEqual({
      type: 'setSharedParam',
      key: 'colorPalette1',
      value,
      origin: TOUCH_CONTROL_ORIGIN,
    });
  });

  it('refuses to build a message without a key', () => {
    expect(() => sharedParamMessage('', 1)).toThrow(/non-empty key/);
  });
});

describe('paramRejected handling', () => {
  it('recognises the engine rejection reply', () => {
    expect(isParamRejected({ type: 'paramRejected', key: 'size', reason: 'source_locked' })).toBe(true);
  });

  it('ignores every other broadcast on the shared control bus', () => {
    expect(isParamRejected({ type: 'mixer', master: 1 })).toBe(false);
    expect(isParamRejected({ type: 'paramRejected' })).toBe(false); // no key
    expect(isParamRejected(null)).toBe(false);
    expect(isParamRejected('paramRejected')).toBe(false);
  });

  it('explains each rejection reason in operator language', () => {
    expect(describeRejection('source_locked', 'portwatch')).toContain('portwatch');
    expect(describeRejection('unknown_key')).toMatch(/older build/);
    expect(describeRejection('mystery')).toContain('mystery');
    expect(describeRejection()).toMatch(/refused/);
  });
});

describe('optimistic-override convergence', () => {
  it('converges when the engine echoes the value we sent', () => {
    expect(numbersConverged(0.5, 0.5)).toBe(true);
    expect(numbersConverged(0.5, 0.5 + CONVERGE_EPSILON / 2)).toBe(true);
  });

  it('does NOT converge while the engine still reports the old value', () => {
    expect(numbersConverged(0.2, 0.8)).toBe(false);
  });

  it('treats the epsilon as inclusive at the boundary', () => {
    // Measured from 0 so the difference is EXACTLY one epsilon as a double.
    // (0.5 + 0.005 is 0.505000000000000004, whose distance from 0.5 is a hair
    // OVER epsilon — a boundary assertion built that way tests floating-point
    // representation, not this function.)
    expect(numbersConverged(0, CONVERGE_EPSILON)).toBe(true);
    expect(numbersConverged(0, CONVERGE_EPSILON * 2)).toBe(false);
    expect(numbersConverged(0.5, 0.5 + CONVERGE_EPSILON * 2)).toBe(false);
  });

  // An unknown value on either side must never read as "caught up" — that
  // would drop the override and bounce the control back to nothing.
  it('never converges against an unknown value', () => {
    expect(numbersConverged(null, 0.5)).toBe(false);
    expect(numbersConverged(0.5, null)).toBe(false);
    expect(numbersConverged(null, null)).toBe(false);
    expect(numbersConverged(NaN, NaN)).toBe(false);
  });

  it('requires ALL THREE hsv components to have caught up', () => {
    const sent = { h: 0.25, s: 1, v: 1 };
    expect(hsvConverged({ h: 0.25, s: 1, v: 1 }, sent)).toBe(true);
    expect(hsvConverged({ h: 0.25, s: 1, v: 0.4 }, sent)).toBe(false);
    expect(hsvConverged({ h: 0.9, s: 1, v: 1 }, sent)).toBe(false);
    expect(hsvConverged(null, sent)).toBe(false);
    expect(hsvConverged({ h: 0.25, s: 1, v: 1 }, null)).toBe(false);
  });

  it('keeps the watchdog well above the engine echo period', () => {
    // CPC broadcasts at 30 Hz; the backstop must be orders of magnitude
    // slower or it would fire during normal operation.
    expect(OVERRIDE_WATCHDOG_MS).toBeGreaterThan(CPC_SEND_INTERVAL_MS * 10);
  });
});

describe('colour target', () => {
  it('maps each single slot to exactly its own CPC key', () => {
    expect(colorKeysFor(1)).toEqual(['colorPalette1']);
    expect(colorKeysFor(2)).toEqual(['colorPalette2']);
  });

  // 'both' became 'all' when the palette grew from 2 slots to 5: the MASTER
  // choice now paints every slot, and writes the two that have a CPC home.
  it('MASTER writes both engine-backed palette keys together', () => {
    expect(colorKeysFor('all')).toEqual(['colorPalette1', 'colorPalette2']);
  });
});

describe('bpmSpeedSync on/off', () => {
  // Threshold must match lib/bpm_speed_sync.js exactly:
  //   const enabled = (numOf(params.bpmSpeedSync) ?? 0) >= 0.5
  it('reads on at or above the engine threshold', () => {
    expect(isBpmSyncOn(1)).toBe(true);
    expect(isBpmSyncOn(BPM_SYNC_THRESHOLD)).toBe(true);
    expect(isBpmSyncOn(0.9)).toBe(true);
  });

  it('reads off below the threshold', () => {
    expect(isBpmSyncOn(0)).toBe(false);
    expect(isBpmSyncOn(0.49)).toBe(false);
  });

  // Unknown must read OFF, not ON: claiming the engine is driving SPEED when
  // we do not know would show a warning banner that may be false.
  it('reads off for an unknown or malformed value', () => {
    expect(isBpmSyncOn(null)).toBe(false);
    expect(isBpmSyncOn(undefined)).toBe(false);
    expect(isBpmSyncOn('1')).toBe(false);
    expect(isBpmSyncOn(NaN)).toBe(false);
  });

  it('writes values the engine will read back as on / off', () => {
    expect(isBpmSyncOn(BPM_SYNC_ON)).toBe(true);
    expect(isBpmSyncOn(BPM_SYNC_OFF)).toBe(false);
  });
});

describe('global effect slots', () => {
  const SLOTS = [
    { slotId: 1, effectId: 'strobe', presetId: 'sync_4hz', enabled: true, active: false },
    { slotId: 4, effectId: 'feedbackTrails', presetId: 'ghost_ship', enabled: true, active: true },
    { slotId: 6, effectId: 'strobe', presetId: 'max_20hz', enabled: true, active: false },
    { slotId: 12, effectId: 'feedbackTrails', presetId: 'long_afterimage', enabled: true, active: false },
    { slotId: 13, effectId: 'feedbackTrails', presetId: 'cosmic_trails', enabled: true, active: false },
  ];

  it('finds the slot already bound to an effect + preset', () => {
    expect(findSlotFor(SLOTS, 'strobe', 'sync_4hz')?.slotId).toBe(1);
    expect(findSlotFor(SLOTS, 'feedbackTrails', 'cosmic_trails')?.slotId).toBe(13);
  });

  it('matches on the PRESET too, not just the effect', () => {
    expect(findSlotFor(SLOTS, 'strobe', 'max_20hz')?.slotId).toBe(6);
    expect(findSlotFor(SLOTS, 'feedbackTrails', 'not_a_preset')).toBeNull();
  });

  it('returns null when the effect is bound nowhere', () => {
    expect(findSlotFor(SLOTS, 'sparkle', 'blizzard')).toBeNull();
    expect(findSlotFor([], 'strobe', 'sync_4hz')).toBeNull();
  });

  it('prefers the lowest slot id so lookups are stable', () => {
    const dupes = [
      { slotId: 20, effectId: 'strobe', presetId: 'sync_4hz' },
      { slotId: 3, effectId: 'strobe', presetId: 'sync_4hz' },
    ];
    expect(findSlotFor(dupes, 'strobe', 'sync_4hz')?.slotId).toBe(3);
  });

  it('reports live active state from the bound slot', () => {
    expect(isEffectActive(SLOTS, 'feedbackTrails', 'ghost_ship')).toBe(true);
    expect(isEffectActive(SLOTS, 'strobe', 'sync_4hz')).toBe(false);
    // Unbound must read INACTIVE, never active — a button claiming an effect
    // is firing when nothing is bound would be a lie about the rig.
    expect(isEffectActive(SLOTS, 'sparkle', 'blizzard')).toBe(false);
  });

  // The Deck/Mixer grid and VSN1 page render only slots 1-8. Provisioning
  // MUST stay clear of them or this tab would visibly rewrite other surfaces.
  it('never provisions into the slots other surfaces display', () => {
    expect(PROVISION_MIN_SLOT_ID).toBeGreaterThan(8);
    expect(firstFreeSlotId(SLOTS)).toBe(9);
  });

  it('skips occupied ids when provisioning', () => {
    const packed = [9, 10, 11].map((slotId) => ({ slotId }));
    expect(firstFreeSlotId(packed)).toBe(12);
  });

  it('returns null when the slot table is full rather than stomping one', () => {
    const full = [];
    for (let id = 1; id <= MAX_SLOT_ID; id++) full.push({ slotId: id });
    expect(firstFreeSlotId(full)).toBeNull();
  });

  it('exposes strobe, random and the three tracer directions', () => {
    const keys = TOUCH_EFFECTS.map((e) => e.key);
    expect(keys).toEqual(['strobe', 'random', 'trace_along', 'trace_rise', 'trace_ring']);
  });

  // Tracers must be waterlineSweep — a BAND that travels the fixtures and
  // loops — not feedbackTrails, which only smears what is already lit.
  it('binds tracers to the travelling-band effect, not the afterimage one', () => {
    const tracers = TOUCH_EFFECTS.filter((e) => e.group === 'tracer');
    expect(tracers).toHaveLength(3);
    for (const t of tracers) {
      expect(t.effectId).toBe('waterlineSweep');
      expect(t.params?.mode).toBe('add');
      expect(t.params?.sync).toBe('free'); // free-run head => loops forever
    }
    // The three differ by travel axis (and by preset — see the distinct-preset
    // test below, which is what keeps them from all lighting at once).
    expect(tracers.map((t) => t.params?.axis)).toEqual(['x', 'y', 'radial']);
  });

  // OPERATOR BUG: all three tracer buttons lit at once. The engine decides a
  // slot is active by effect + PRESET only:
  //   case 'waterlineSweep': return c.sweep.enabled && c.sweep.presetId === slot.presetId
  // so tracers sharing a preset ALL report active together. Each must own one.
  it('gives every tracer a DISTINCT preset so only the tapped one lights', () => {
    const tracers = TOUCH_EFFECTS.filter((e) => e.group === 'tracer');
    const presets = tracers.map((t) => t.presetId);
    expect(new Set(presets).size).toBe(tracers.length);
  });

  it('only uses presets that exist on the engine effect', () => {
    // waterlineSweep ships exactly these three.
    const shipped = ['rising_tide', 'beat_wipe', 'shadow_pass'];
    for (const t of TOUCH_EFFECTS.filter((e) => e.group === 'tracer')) {
      expect(shipped).toContain(t.presetId);
    }
  });

  it('finds the lit tracer, and none when all are dark', () => {
    const specs = TOUCH_EFFECTS.filter((e) => e.group === 'tracer');
    const dark = specs.map((s, i) => ({
      slotId: 20 + i, effectId: s.effectId, presetId: s.presetId, active: false,
    }));
    expect(activeTracer(dark)).toBeNull();
    const lit = dark.map((s, i) => ({ ...s, active: i === 1 }));
    expect(activeTracer(lit)?.spec.key).toBe(specs[1].key);
    expect(activeTracer(lit)?.slot.slotId).toBe(21);
  });

  it('maps Z onto a sweep rate that never freezes and never strobes', () => {
    expect(padZToSweepHz(0)).toBe(SWEEP_HZ_MIN);
    expect(padZToSweepHz(1)).toBe(SWEEP_HZ_MAX);
    expect(SWEEP_HZ_MIN).toBeGreaterThan(0); // 0 would leave the band parked
    expect(padZToSweepHz(0.5)).toBeCloseTo((SWEEP_HZ_MIN + SWEEP_HZ_MAX) / 2, 10);
    // Engine validator: speedHz must be a non-negative finite number.
    for (const z of [0, 0.25, 0.5, 0.75, 1]) {
      expect(Number.isFinite(padZToSweepHz(z))).toBe(true);
      expect(padZToSweepHz(z)).toBeGreaterThanOrEqual(0);
    }
  });

  it('keeps every tracer override inside the engine validator ranges', () => {
    for (const t of TOUCH_EFFECTS.filter((e) => e.group === 'tracer')) {
      const p = t.params as Record<string, number | string | number[]>;
      expect(['x', 'y', 'z', 'radial']).toContain(p.axis);
      expect(p.width as number).toBeGreaterThan(0);
      expect(p.width as number).toBeLessThanOrEqual(1);
      expect(p.amount as number).toBeGreaterThanOrEqual(0);
      expect(p.amount as number).toBeLessThanOrEqual(1);
      expect(p.speedHz as number).toBeGreaterThanOrEqual(0);
      expect(['add', 'darken']).toContain(p.mode);
      expect((p.color as number[]).length).toBe(6);
    }
  });

  // Three tracers share effectId+presetId, so the slot lookup MUST key on the
  // params or they would collapse onto one slot and fight over it.
  it('distinguishes slots that differ only by params override', () => {
    const sweeps = [
      { slotId: 9, effectId: 'waterlineSweep', presetId: 'rising_tide', paramsOverride: { axis: 'x' }, active: true },
      { slotId: 10, effectId: 'waterlineSweep', presetId: 'rising_tide', paramsOverride: { axis: 'y' }, active: false },
    ];
    expect(findSlotFor(sweeps, 'waterlineSweep', 'rising_tide', { axis: 'x' })?.slotId).toBe(9);
    expect(findSlotFor(sweeps, 'waterlineSweep', 'rising_tide', { axis: 'y' })?.slotId).toBe(10);
    expect(findSlotFor(sweeps, 'waterlineSweep', 'rising_tide', { axis: 'radial' })).toBeNull();
    expect(isEffectActive(sweeps, 'waterlineSweep', 'rising_tide', { axis: 'x' })).toBe(true);
    expect(isEffectActive(sweeps, 'waterlineSweep', 'rising_tide', { axis: 'y' })).toBe(false);
  });

  it('matches array params element-wise and ignores extra slot fields', () => {
    expect(paramsMatch({ color: [1, 1, 1, 0, 0, 0], extra: 9 }, { color: [1, 1, 1, 0, 0, 0] })).toBe(true);
    expect(paramsMatch({ color: [1, 0, 0, 0, 0, 0] }, { color: [1, 1, 1, 0, 0, 0] })).toBe(false);
    expect(paramsMatch({ color: 'nope' }, { color: [1, 1, 1, 0, 0, 0] })).toBe(false);
    // A spec with no params must match anything (unchanged behavior).
    expect(paramsMatch(undefined, undefined)).toBe(true);
    expect(paramsMatch({ axis: 'x' }, undefined)).toBe(true);
  });
});

describe('5-colour palette', () => {
  const base: { h: number; s: number; v: number } = { h: 0.1, s: 0.8, v: 0.9 };

  it('has five slots, of which only 1 and 2 reach the engine', () => {
    expect(COLOR_SLOT_COUNT).toBe(5);
    expect(COLOR_SLOTS).toEqual([1, 2, 3, 4, 5]);
    expect(isEngineBackedSlot(1)).toBe(true);
    expect(isEngineBackedSlot(2)).toBe(true);
    // The CPC has no colorPalette3..5 — these are tab-local palette storage.
    expect(isEngineBackedSlot(3)).toBe(false);
    expect(isEngineBackedSlot(4)).toBe(false);
    expect(isEngineBackedSlot(5)).toBe(false);
  });

  it('maps only engine-backed slots onto CPC keys', () => {
    expect(colorKeysFor(1)).toEqual(['colorPalette1']);
    expect(colorKeysFor(2)).toEqual(['colorPalette2']);
    expect(colorKeysFor(3)).toEqual([]);
    expect(colorKeysFor(5)).toEqual([]);
    expect(colorKeysFor('all')).toEqual(['colorPalette1', 'colorPalette2']);
  });

  it('MASTER targets every slot; a single slot targets only itself', () => {
    expect(slotsFor('all')).toEqual([1, 2, 3, 4, 5]);
    expect(slotsFor(3)).toEqual([3]);
  });

  it('rotates hue around the wheel and wraps both ways', () => {
    expect(rotateHue(0, 180)).toBeCloseTo(0.5, 10);
    expect(rotateHue(0.75, 180)).toBeCloseTo(0.25, 10); // wraps past 1
    expect(rotateHue(0.5, 360)).toBeCloseTo(0.5, 10);
    expect(rotateHue(0.5, 0)).toBeCloseTo(0.5, 10);
    expect(rotateHue(0.1, -180)).toBeCloseTo(0.6, 10); // negative wraps
  });

  it('MASTER makes all five identical', () => {
    const p = uniformPalette(base);
    expect(p).toHaveLength(5);
    for (const c of p) expect(c).toEqual({ h: base.h, s: base.s, v: base.v });
  });

  // Operator: "complementary colours should be 5 DISTINCT colours." The first
  // cut alternated base/opposite, which is only TWO hues across five slots.
  it('COMPLEMENT produces five DISTINCT hues', () => {
    const p = complementaryPalette(base);
    expect(p).toHaveLength(5);
    expect(new Set(p.map((c) => c.h.toFixed(6))).size).toBe(5);
  });

  // COMPLEMENT used to mean 180° OPPOSITION. The operator redefined the three
  // buttons by what they should LOOK like: "complement is colours that go
  // together and contrast is clashing colours". So opposition moved to CONTRAST
  // (an even ring reaches every part of the wheel — maximum clash) and
  // COMPLEMENT became the harmonious one. These two tests replace the pair that
  // asserted the old opposition design.
  it('COMPLEMENT does NOT put the 180° opposite on slot 2 any more', () => {
    const p = complementaryPalette(base);
    expect(p[0].h).toBeCloseTo(base.h, 10);
    const d = Math.abs(p[1].h - rotateHue(base.h, 180)) % 1;
    expect(Math.min(d, 1 - d) * 360).toBeGreaterThan(60);
  });

  it('COMPLEMENT keeps every hue in ONE family — nothing sits opposite anything', () => {
    // The harmony test: no pair in the set may approach opposition, because a
    // near-180° pair is the loudest thing two hues can do to each other.
    const p = complementaryPalette(base);
    for (let i = 0; i < p.length; i++) {
      for (let j = i + 1; j < p.length; j++) {
        const d = Math.abs(p[i].h - p[j].h) % 1;
        expect(Math.min(d, 1 - d) * 360).toBeLessThanOrEqual(120.001);
      }
    }
    // Saturation/value carried through so the set reads as one family.
    for (const c of p) { expect(c.s).toBe(base.s); expect(c.v).toBe(base.v); }
  });

  it('CONTRAST is the one that clashes — it DOES reach near-opposition', () => {
    const p = contrastingPalette(base);
    const spans = [];
    for (let i = 0; i < p.length; i++) {
      for (let j = i + 1; j < p.length; j++) {
        const d = Math.abs(p[i].h - p[j].h) % 1;
        spans.push(Math.min(d, 1 - d) * 360);
      }
    }
    // 72° spacing puts pairs at 144° — far past COMPLEMENT's 120° family cap.
    expect(Math.max(...spans)).toBeGreaterThan(120);
  });

  // ── "nothing that looks bad", made objective ────────────────────────────
  // Slots 3-5 transmit a HUE ONLY (setDeckChannelControl(id, c.h); patterns
  // render them with colour 1's S/V), so a set cannot be rescued with tints or
  // shades. Separation is therefore what decides whether it reads well: two
  // fully-saturated LEDs closer than ~30° read as one colour got slightly
  // wrong, and muddy where they meet. This is the regression that let the old
  // COMPLEMENT ship with a 20° minimum.
  it('every scheme keeps all five hues at least MIN_HUE_SEPARATION_DEG apart', () => {
    for (const gen of [complementaryPalette, contrastingPalette]) {
      // sweep the whole wheel — separation must hold for ANY colour the
      // operator picks, not just a convenient one
      for (let deg = 0; deg < 360; deg += 7) {
        const p = gen({ h: deg / 360, s: 1, v: 1 });
        expect(new Set(p.map((c) => c.h.toFixed(6))).size).toBe(5);
        // 1e-9 tolerance: a 30° step round-trips through hue-as-fraction as
        // 29.99999999999997. The separation is exactly 30° in the design.
        expect(minHueSeparationDeg(p)).toBeGreaterThanOrEqual(MIN_HUE_SEPARATION_DEG - 1e-9);
      }
    }
  });

  // Operator: "hue is the same colour just different brightnesses".
  it('HUE holds ONE colour and steps only the brightness', () => {
    const p = monochromePalette(base);
    expect(p).toHaveLength(5);
    // one hue and one saturation across the whole set — this is the point
    for (const c of p) {
      expect(c.h).toBeCloseTo(base.h, 10);
      expect(c.s).toBe(base.s);
    }
    // five DIFFERENT brightnesses, brightest first, strictly descending
    const vs = p.map((c) => c.v);
    expect(new Set(vs).size).toBe(5);
    for (let i = 1; i < vs.length; i++) expect(vs[i]).toBeLessThan(vs[i - 1]);
    expect(vs[0]).toBeCloseTo(base.v, 10);
  });

  it('HUE never drops a slot under the tab-wide 10% brightness floor', () => {
    for (const v of [1, 0.5, 0.2, MIN_BRIGHTNESS, 0]) {
      for (const c of monochromePalette({ h: 0.3, s: 1, v })) {
        expect(c.v).toBeGreaterThanOrEqual(MIN_BRIGHTNESS);
      }
    }
  });

  it('the OLD complement offsets would fail that floor (the bug is really fixed)', () => {
    // [0, 180, -20, 200, 20] — three hues in a 40° span, two more 20° apart.
    const old = [0, 180, -20, 200, 20].map((d) => ({ h: rotateHue(base.h, d), s: 1, v: 1 }));
    expect(minHueSeparationDeg(old)).toBeLessThan(MIN_HUE_SEPARATION_DEG);
    expect(minHueSeparationDeg(complementaryPalette(base))).toBeGreaterThan(
      minHueSeparationDeg(old),
    );
  });

  it('COMPLEMENT gives five analogous hues 30° apart, keeping the operator colour on slot 1', () => {
    const p = complementaryPalette(base);
    expect(p).toHaveLength(5);
    // slot 1 is exactly what the operator picked — the button builds around it
    expect(p[0].h).toBeCloseTo(base.h, 10);
    // the set spans a 120° analogous arc in 30° steps
    const offsets = p
      .map((c) => {
        const d = ((c.h - base.h) % 1 + 1) % 1;
        return Math.round((d > 0.5 ? d - 1 : d) * 360);
      })
      .sort((a, b) => a - b);
    expect(offsets).toEqual([-60, -30, 0, 30, 60]);
    // the two ENGINE-BACKED slots carry a real spread for stock 2-colour
    // patterns rather than a barely-visible one
    const eng = Math.abs(((p[1].h - p[0].h) % 1 + 1) % 1) * 360;
    expect(Math.min(eng, 360 - eng)).toBeCloseTo(60, 5);
    for (const c of p) { expect(c.s).toBe(base.s); expect(c.v).toBe(base.v); }
  });

  it('COMPLEMENT stays analogous — no hue escapes the 120° family arc', () => {
    for (let deg = 0; deg < 360; deg += 11) {
      const b = { h: deg / 360, s: 1, v: 1 };
      for (const c of complementaryPalette(b)) {
        const d = Math.abs(c.h - b.h) % 1;
        expect(Math.min(d, 1 - d) * 360).toBeLessThanOrEqual(60.001);
      }
    }
  });

  it('CONTRAST spreads five hues evenly around the wheel', () => {
    const p = contrastingPalette(base);
    expect(p).toHaveLength(5);
    for (let i = 0; i < 5; i++) {
      expect(p[i].h).toBeCloseTo(rotateHue(base.h, 72 * i), 10);
    }
    // No two slots share a hue — that is what makes them contrasting.
    expect(new Set(p.map((c) => c.h.toFixed(6))).size).toBe(5);
  });

  it('every generated palette stays inside the unit interval', () => {
    for (const gen of [uniformPalette, monochromePalette, complementaryPalette, contrastingPalette]) {
      for (const c of gen({ h: 0.97, s: 1, v: 1 })) {
        expect(c.h).toBeGreaterThanOrEqual(0);
        expect(c.h).toBeLessThan(1);
        expect(c.s).toBeGreaterThanOrEqual(0);
        expect(c.v).toBeLessThanOrEqual(1);
      }
    }
  });

  it('converts a colour to the engine RGBWAU array, leaving W/A/UV dark', () => {
    const c6 = hsvToColor6({ h: 0, s: 1, v: 1 }); // pure red
    expect(c6).toHaveLength(6);
    expect(c6[0]).toBe(1);
    expect(c6[1]).toBe(0);
    expect(c6[2]).toBe(0);
    // W / A / UV are the mission-critical whites — never tinted.
    expect(c6.slice(3)).toEqual([0, 0, 0]);
    for (const v of c6) {
      expect(Number.isFinite(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it('knows which effects can be tinted at all', () => {
    // Verified against the engine's validateParams: these four call
    // validateColor6; strobe and sparkle declare no colour.
    expect(effectTakesColor('waterlineSweep')).toBe(true);
    expect(effectTakesColor('colorWash')).toBe(true);
    expect(effectTakesColor('strobe')).toBe(false);
    expect(effectTakesColor('sparkle')).toBe(false);
  });
});

describe('brightness floor (TOUCH PANEL only)', () => {
  it('never lets the rig go below the floor', () => {
    expect(clampBrightness(0)).toBe(MIN_BRIGHTNESS);
    expect(clampBrightness(-5)).toBe(MIN_BRIGHTNESS);
    expect(clampBrightness(0.05)).toBe(MIN_BRIGHTNESS);
  });

  it('passes through values at or above the floor', () => {
    expect(clampBrightness(MIN_BRIGHTNESS)).toBe(MIN_BRIGHTNESS);
    expect(clampBrightness(0.5)).toBe(0.5);
    expect(clampBrightness(1)).toBe(1);
    expect(clampBrightness(2)).toBe(1);
  });

  it('maps the whole pad width onto the usable range — no dead strip', () => {
    expect(padXToBrightness(0)).toBe(MIN_BRIGHTNESS);
    expect(padXToBrightness(1)).toBe(1);
    expect(padXToBrightness(0.5)).toBeCloseTo(MIN_BRIGHTNESS + 0.5 * (1 - MIN_BRIGHTNESS), 10);
  });

  it('round-trips a level back to its pad position', () => {
    for (const v of [MIN_BRIGHTNESS, 0.3, 0.55, 0.9, 1]) {
      expect(padXToBrightness(brightnessToPadX(v))).toBeCloseTo(v, 10);
    }
    // Anything under the floor pins to the left edge.
    expect(brightnessToPadX(0)).toBe(0);
  });

  it('X drives brightness and never a CPC key', () => {
    expect(PAD_AXES.x.transport).toBe('master');
    expect(PAD_AXES.x.key).toBeNull();
    expect(PAD_AXES.y.key).toBe(CPC.ROTATE);
    expect(PAD_AXES.z.key).toBe(CPC.SPEED);
  });
});

describe('control surface constants', () => {
  it('only names CPC keys that exist in the engine schema', () => {
    // Cross-checked against the live engine's GET /param-center/schema.
    expect(Object.values(CPC).sort()).toEqual(
      ['bpmSpeedSync', 'colorPalette1', 'colorPalette2', 'colorTransitionMs', 'rotate', 'size', 'speed'].sort(),
    );
  });

  it('maps every pad axis to a real target and a truthful label', () => {
    // X moved off the CPC entirely: it is the rig master now, because `size`
    // had no legible effect on this rig. Y and Z stay CPC params.
    expect(PAD_AXES.x.transport).toBe('master');
    expect(PAD_AXES.x.key).toBeNull();
    expect(PAD_AXES.y.key).toBe(CPC.ROTATE);
    expect(PAD_AXES.z.key).toBe(CPC.SPEED);
    // The label must name what it drives, never just the axis letter — the
    // operator has to be able to see what the rig will actually do.
    for (const axis of [PAD_AXES.x, PAD_AXES.y, PAD_AXES.z]) {
      expect(axis.label.length).toBeGreaterThan(0);
      expect(axis.label).not.toBe(axis.axis);
      expect(axis.hint.length).toBeGreaterThan(0);
    }
  });

  it('keeps the colour-fade bounds inside the engine schema range', () => {
    expect(COLOR_FADE_MIN_MS).toBe(0);
    expect(COLOR_FADE_MAX_MS).toBe(10000);
  });
});

describe('PAINT SHIP zones', () => {
  it('paints five zones, one per colour slot', () => {
    expect(PAINT_ZONES).toHaveLength(5);
    expect(PAINT_ZONES.map((z) => z.slot)).toEqual([1, 2, 3, 4, 5]);
    for (const s of COLOR_SLOTS) expect(paintZoneFor(s)).not.toBeNull();
  });

  // Every name here must exist on the live model or the engine 404s the PUT.
  // This is the set taken from GET /group-fixed-colors.groups (24 groups).
  it('only names groups that exist on the Titanic model', () => {
    const MODEL_GROUPS = [
      'Left Auditorium', 'Left Back Rails', 'Left Back Wall', 'Left Front Rails',
      'Left Front Wall', 'Left Small SmokeStack', 'Left SmokeStack',
      'Left_Back_Left', 'Left_Back_Right', 'Left_Front_Left', 'Left_Front_Right',
      'Right Auditorium', 'Right Back Rails', 'Right Back Wall', 'Right Front Rails',
      'Right Front Wall', 'Right Small SmokeStack', 'Right SmokeStacks',
      'Right_Back_Left', 'Right_Back_Right', 'Right_Front_Left', 'Right_Front_Right',
      'TE Sign', 'TE Sign 2',
    ];
    for (const g of allPaintedGroups()) expect(MODEL_GROUPS).toContain(g);
  });

  it('never paints the same group twice', () => {
    const all = allPaintedGroups();
    expect(new Set(all).size).toBe(all.length);
  });

  // The whole point of zoning rather than painting everything: patterns AND
  // the tracer band must still animate somewhere.
  it('leaves most of the rig unpainted so it keeps animating', () => {
    expect(allPaintedGroups().length).toBeLessThan(24);
  });

  it('splits a colour into hue-at-full-value plus a brightness scalar', () => {
    const { color, brightness } = paintPayload({ h: 0, s: 1, v: 0.4 });
    expect(color).toEqual([1, 0, 0, 0, 0, 0]); // pure red at FULL value
    expect(brightness).toBeCloseTo(0.4, 10);   // V carried separately
  });

  it('clamps a painted brightness into the engine range', () => {
    expect(paintPayload({ h: 0, s: 1, v: 5 }).brightness).toBe(1);
    expect(paintPayload({ h: 0, s: 1, v: -2 }).brightness).toBe(0);
  });
});

describe('CYCLE — all five colours through the two pattern slots', () => {
  const C5 = [
    { h: 0.0, s: 1, v: 1 }, { h: 0.2, s: 1, v: 1 }, { h: 0.4, s: 1, v: 1 },
    { h: 0.6, s: 1, v: 1 }, { h: 0.8, s: 1, v: 1 },
  ];

  it('holds each pair at least long enough for the fade to finish', () => {
    // Re-targeting a ramp that is still running is the "scrubs through the
    // rainbow" failure the colour pad already had to fix — do not reintroduce.
    expect(cycleStepMs(4000)).toBe(4500);
    expect(cycleStepMs(0)).toBe(CYCLE_MIN_STEP_MS);
    expect(cycleStepMs(null)).toBe(CYCLE_MIN_STEP_MS);
    expect(cycleStepMs(10000)).toBe(10500);
  });

  it('never steps faster than the floor even for a tiny fade', () => {
    expect(cycleStepMs(10)).toBe(CYCLE_MIN_STEP_MS);
  });

  it('walks consecutive pairs around the ring and wraps', () => {
    expect(cyclePairAt(C5, 0)).toEqual({ c1: C5[0], c2: C5[1] });
    expect(cyclePairAt(C5, 3)).toEqual({ c1: C5[3], c2: C5[4] });
    expect(cyclePairAt(C5, 4)).toEqual({ c1: C5[4], c2: C5[0] }); // wraps
    expect(cyclePairAt(C5, 5)).toEqual({ c1: C5[0], c2: C5[1] }); // full loop
  });

  it('uses EVERY colour across one full loop', () => {
    const seen = new Set<number>();
    for (let i = 0; i < C5.length; i++) {
      const p = cyclePairAt(C5, i)!;
      seen.add(p.c1.h);
      seen.add(p.c2.h);
    }
    expect(seen.size).toBe(5);
  });

  it('skips empty slots instead of blanking the rig', () => {
    const sparse = [C5[0], null, C5[2], null, null];
    expect(cyclePairAt(sparse, 0)).toEqual({ c1: C5[0], c2: C5[2] });
    expect(cyclePairAt(sparse, 1)).toEqual({ c1: C5[2], c2: C5[0] });
  });

  it('handles one colour and no colours without inventing values', () => {
    expect(cyclePairAt([C5[0], null, null, null, null], 0)).toEqual({ c1: C5[0], c2: C5[0] });
    expect(cyclePairAt([null, null, null, null, null], 0)).toBeNull();
    expect(cyclePairAt([], 0)).toBeNull();
  });

  it('tolerates a negative index', () => {
    expect(cyclePairAt(C5, -1)).toEqual({ c1: C5[4], c2: C5[0] });
  });
});

describe('CYCLE zone rotation — several colours at once, each visiting each zone', () => {
  const C5 = [
    { h: 0.0, s: 1, v: 1 }, { h: 0.2, s: 1, v: 1 }, { h: 0.4, s: 1, v: 1 },
    { h: 0.6, s: 1, v: 1 }, { h: 0.8, s: 1, v: 1 },
  ];

  // The whole point: the rig shows DIFFERENT colours on DIFFERENT fixtures at
  // the same moment, not one colour everywhere.
  it('gives every zone a DIFFERENT colour at every step', () => {
    for (let step = 0; step < 7; step++) {
      const hues = rotationAt(C5, step).map((c) => c!.h);
      expect(new Set(hues).size).toBe(5);
    }
  });

  it('rotates so each colour visits each zone over a full loop', () => {
    const zone0 = [0, 1, 2, 3, 4].map((s) => rotatedColorFor(C5, 0, s)!.h);
    expect(new Set(zone0).size).toBe(5); // zone 0 sees all five
  });

  it('wraps forwards and backwards', () => {
    expect(rotatedColorFor(C5, 4, 1)!.h).toBe(C5[0].h);
    expect(rotatedColorFor(C5, 0, -1)!.h).toBe(C5[4].h);
    expect(rotatedColorFor(C5, 0, 5)!.h).toBe(C5[0].h);
  });

  it('returns null for an empty palette rather than inventing a colour', () => {
    expect(rotatedColorFor([], 0, 0)).toBeNull();
    expect(rotationAt([], 0)).toEqual([]);
  });

  it('passes unset slots through as null so they are simply not painted', () => {
    const sparse = [C5[0], null, C5[2], null, C5[4]];
    const got = rotationAt(sparse, 1);
    expect(got).toHaveLength(5);
    expect(got.filter((c) => c === null)).toHaveLength(2);
  });
});

describe('CYCLE shows ONLY chosen colours (operator: "period")', () => {
  const C5 = [
    { h: 0.0, s: 1, v: 1 }, { h: 0.2, s: 1, v: 1 }, { h: 0.4, s: 1, v: 1 },
    { h: 0.6, s: 1, v: 1 }, { h: 0.8, s: 1, v: 1 },
  ];

  // A PAIR of different colours makes the pattern interpolate BETWEEN them,
  // painting hues the operator never picked. One colour in both slots is what
  // guarantees "only the colours I chose".
  it('returns a single colour per step, always from the chosen set', () => {
    for (let step = 0; step < 12; step++) {
      const c = cycleSoloAt(C5, step);
      expect(C5.some((x) => x.h === c!.h)).toBe(true);
    }
  });

  it('walks every chosen colour and then repeats — nothing else appears', () => {
    const seen = new Set<number>();
    for (let step = 0; step < 5; step++) seen.add(cycleSoloAt(C5, step)!.h);
    expect(seen.size).toBe(5);
    expect(cycleSoloAt(C5, 5)!.h).toBe(C5[0].h); // wraps, no new colours
  });

  it('only walks the colours actually set — empty slots are not invented', () => {
    const two = [C5[0], null, C5[2], null, null];
    const seen = new Set<number>();
    for (let step = 0; step < 6; step++) seen.add(cycleSoloAt(two, step)!.h);
    expect([...seen].sort()).toEqual([C5[0].h, C5[2].h].sort());
  });

  it('returns null for an empty palette rather than a fabricated colour', () => {
    expect(cycleSoloAt([null, null], 0)).toBeNull();
    expect(cycleSoloAt([], 0)).toBeNull();
  });
});

describe('driving a pattern\'s own extra hue sliders', () => {
  const EX = [
    { id: 1037917937, name: 'sliderLocalSpeed' },
    { id: 111, name: 'sliderHue3' },
    { id: 222, name: 'sliderHue4' },
    { id: 333, name: 'sliderHue5' },
  ];

  it('maps only slots 3-5 onto pattern sliders', () => {
    expect(patternHueControlFor(1)).toBeNull();
    expect(patternHueControlFor(2)).toBeNull();
    expect(patternHueControlFor(3)).toBe('sliderHue3');
    expect(patternHueControlFor(4)).toBe('sliderHue4');
    expect(patternHueControlFor(5)).toBe('sliderHue5');
  });

  it('resolves a control id by NAME, never by position', () => {
    expect(findExportId(EX, 'sliderHue3')).toBe(111);
    expect(findExportId(EX, 'sliderHue5')).toBe(333);
  });

  // A wrong id would land on a DIFFERENT slider and change something the
  // operator never touched — so an absent control must resolve to null, and
  // the caller writes nothing.
  it('returns null when the running pattern has no such slider', () => {
    expect(findExportId(EX, 'sliderHue9')).toBeNull();
    expect(findExportId([], 'sliderHue3')).toBeNull();
    expect(findExportId(undefined, 'sliderHue3')).toBeNull();
    expect(findExportId(null, 'sliderHue3')).toBeNull();
  });

  it('ignores malformed export entries', () => {
    expect(findExportId([{ name: 'sliderHue3' } as never], 'sliderHue3')).toBeNull();
  });
});
