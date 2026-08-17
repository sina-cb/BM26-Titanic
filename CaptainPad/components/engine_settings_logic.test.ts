/**
 * Pinned logic tests for the ENGINE SETTINGS card (auto-save + boot mode).
 *
 * Covers the behaviours the card relies on: DEFAULT-ON, optimistic toggle,
 * defensive reconcile from an engine payload (POST echo or the `engineSettings`
 * WS broadcast), and the exact hint wording — plus, since report `_236`, the
 * persisted BOOT MODE preference and its "next boot / gate stays shut" copy.
 */
import { describe, expect, it } from 'vitest';

import {
  BOOT_MODE_OPTIONS,
  DEFAULT_ENGINE_SETTINGS,
  autoSaveHint,
  bootModeHint,
  normalizeBootMode,
  reconcileEngineSettings,
  toggledEngineSettings,
  withBootMode,
  type EngineSettingsState,
} from './engine_settings_logic';

/** A complete state, so each test names only the field it is about. */
const state = (patch: Partial<EngineSettingsState> = {}): EngineSettingsState =>
  ({ ...DEFAULT_ENGINE_SETTINGS, ...patch });

describe('DEFAULT_ENGINE_SETTINGS', () => {
  it('defaults auto-save ON so the card never flashes OFF before the engine answers', () => {
    expect(DEFAULT_ENGINE_SETTINGS.autoSave).toBe(true);
  });

  it('defaults boot mode to PERFORMANCE — the safe direction is "show gate on"', () => {
    // A pad that painted "boots into EDIT" before the engine answered would be
    // advertising an unlocked rig it has not confirmed (report _236).
    expect(DEFAULT_ENGINE_SETTINGS.bootMode).toBe('performance');
  });
});

describe('toggledEngineSettings', () => {
  it('flips ON → OFF optimistically', () => {
    expect(toggledEngineSettings(state({ autoSave: true })).autoSave).toBe(false);
  });

  it('flips OFF → ON optimistically', () => {
    expect(toggledEngineSettings(state({ autoSave: false })).autoSave).toBe(true);
  });

  it('returns a NEW object (no in-place mutation) and leaves boot mode alone', () => {
    const prev = state({ autoSave: true, bootMode: 'edit' });
    const next = toggledEngineSettings(prev);
    expect(next).not.toBe(prev);
    expect(prev.autoSave).toBe(true);
    expect(next.bootMode).toBe('edit');
  });
});

describe('reconcileEngineSettings', () => {
  it('adopts a valid boolean from the engine payload', () => {
    expect(reconcileEngineSettings(state({ autoSave: true }), { autoSave: false }).autoSave)
      .toBe(false);
  });

  it('keeps the previous value when autoSave is missing', () => {
    expect(reconcileEngineSettings(state({ autoSave: false }), {}).autoSave).toBe(false);
  });

  it('keeps the previous value when autoSave is a non-boolean (malformed field)', () => {
    // A stray string/number must not blow away a good local value.
    expect(reconcileEngineSettings(state({ autoSave: true }), { autoSave: 'false' as unknown }).autoSave)
      .toBe(true);
    expect(reconcileEngineSettings(state({ autoSave: true }), { autoSave: 0 as unknown }).autoSave)
      .toBe(true);
  });

  it('tolerates a null/undefined payload without throwing', () => {
    expect(reconcileEngineSettings(state({ autoSave: true }), null)).toEqual(state({ autoSave: true }));
    expect(reconcileEngineSettings(state({ autoSave: false }), undefined))
      .toEqual(state({ autoSave: false }));
  });

  it('adopts a valid boot mode from the engine payload', () => {
    expect(reconcileEngineSettings(state(), { autoSave: true, bootMode: 'edit' }).bootMode)
      .toBe('edit');
    expect(reconcileEngineSettings(state({ bootMode: 'edit' }), { autoSave: true, bootMode: 'performance' }).bootMode)
      .toBe('performance');
  });

  it('keeps the previous boot mode for an absent or junk field', () => {
    // A pre-_236 engine never sends `bootMode`; it must not make the card
    // invent a boot face, in either direction.
    expect(reconcileEngineSettings(state({ bootMode: 'edit' }), { autoSave: true }).bootMode)
      .toBe('edit');
    expect(reconcileEngineSettings(state({ bootMode: 'edit' }), { bootMode: 'PERFORMANCE' }).bootMode)
      .toBe('edit');
    expect(reconcileEngineSettings(state(), { bootMode: 42 as unknown }).bootMode)
      .toBe('performance');
  });
});

describe('normalizeBootMode', () => {
  it('accepts exactly the two engine values and nothing else', () => {
    expect(normalizeBootMode('performance')).toBe('performance');
    expect(normalizeBootMode('edit')).toBe('edit');
    for (const junk of ['EDIT', 'Performance', '', null, undefined, 0, {}, []]) {
      expect(normalizeBootMode(junk)).toBeNull();
    }
  });
});

describe('withBootMode', () => {
  it('sets the mode without disturbing autoSave, on a new object', () => {
    const prev = state({ autoSave: false, bootMode: 'performance' });
    const next = withBootMode(prev, 'edit');
    expect(next).not.toBe(prev);
    expect(next).toEqual({ autoSave: false, bootMode: 'edit' });
    expect(prev.bootMode).toBe('performance');
  });
});

describe('autoSaveHint', () => {
  it('describes automatic persistence + the mixer-never-saved caveat when ON', () => {
    const hint = autoSaveHint(true);
    expect(hint).toMatch(/persist automatically/i);
    expect(hint).toMatch(/mixer channel parameters are never saved/i);
  });

  it('warns that a restart reverts to the last save when OFF', () => {
    const hint = autoSaveHint(false);
    expect(hint).toMatch(/nothing persists until you save explicitly/i);
    expect(hint).toMatch(/restart reverts to the last save/i);
  });
});

describe('bootModeHint', () => {
  it('always says WHEN the change applies — the toggle is not a live switch', () => {
    for (const mode of ['performance', 'edit'] as const) {
      expect(bootModeHint(mode)).toMatch(/NEXT engine start/);
    }
  });

  it('EDIT copy states that the passcode gate stays shut and nothing saves', () => {
    // The one misreading that would matter on the playa: "boots into edit"
    // meaning "boots wide open". docs/56's engine-side gate never opens itself.
    const hint = bootModeHint('edit');
    expect(hint).toMatch(/passcode gate stays on/i);
    expect(hint).toMatch(/saves NOTHING/);
  });

  it('PERFORMANCE copy names the lock and the pre-show snapshot', () => {
    const hint = bootModeHint('performance');
    expect(hint).toMatch(/locked/i);
    expect(hint).toMatch(/pre-show snapshot/i);
  });
});

describe('BOOT_MODE_OPTIONS', () => {
  it('offers exactly the two engine modes, performance first', () => {
    expect(BOOT_MODE_OPTIONS.map((o) => o.value)).toEqual(['performance', 'edit']);
    for (const opt of BOOT_MODE_OPTIONS) {
      expect(opt.label.length).toBeGreaterThan(0);
      expect(opt.detail.length).toBeGreaterThan(0);
    }
  });

  it('the EDIT option itself repeats the "still no saving" qualifier', () => {
    const edit = BOOT_MODE_OPTIONS.find((o) => o.value === 'edit');
    expect(edit?.detail.toLowerCase()).toContain('passcode');
  });
});
