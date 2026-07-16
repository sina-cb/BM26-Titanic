/**
 * Pinned logic tests for the ENGINE SETTINGS card (auto-save toggle).
 *
 * Covers the three behaviours the card relies on: DEFAULT-ON, optimistic
 * toggle, defensive reconcile from an engine payload (POST echo or the
 * `engineSettings` WS broadcast), and the exact hint wording.
 */
import { describe, expect, it } from 'vitest';

import {
  DEFAULT_ENGINE_SETTINGS,
  autoSaveHint,
  reconcileEngineSettings,
  toggledEngineSettings,
} from './engine_settings_logic';

describe('DEFAULT_ENGINE_SETTINGS', () => {
  it('defaults auto-save ON so the card never flashes OFF before the engine answers', () => {
    expect(DEFAULT_ENGINE_SETTINGS.autoSave).toBe(true);
  });
});

describe('toggledEngineSettings', () => {
  it('flips ON → OFF optimistically', () => {
    expect(toggledEngineSettings({ autoSave: true })).toEqual({ autoSave: false });
  });

  it('flips OFF → ON optimistically', () => {
    expect(toggledEngineSettings({ autoSave: false })).toEqual({ autoSave: true });
  });

  it('returns a NEW object (no in-place mutation)', () => {
    const prev = { autoSave: true };
    const next = toggledEngineSettings(prev);
    expect(next).not.toBe(prev);
    expect(prev.autoSave).toBe(true);
  });
});

describe('reconcileEngineSettings', () => {
  it('adopts a valid boolean from the engine payload', () => {
    expect(reconcileEngineSettings({ autoSave: true }, { autoSave: false }))
      .toEqual({ autoSave: false });
  });

  it('keeps the previous value when autoSave is missing', () => {
    expect(reconcileEngineSettings({ autoSave: false }, {})).toEqual({ autoSave: false });
  });

  it('keeps the previous value when autoSave is a non-boolean (malformed field)', () => {
    // A stray string/number must not blow away a good local value.
    expect(reconcileEngineSettings({ autoSave: true }, { autoSave: 'false' as unknown }))
      .toEqual({ autoSave: true });
    expect(reconcileEngineSettings({ autoSave: true }, { autoSave: 0 as unknown }))
      .toEqual({ autoSave: true });
  });

  it('tolerates a null/undefined payload without throwing', () => {
    expect(reconcileEngineSettings({ autoSave: true }, null)).toEqual({ autoSave: true });
    expect(reconcileEngineSettings({ autoSave: false }, undefined)).toEqual({ autoSave: false });
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
