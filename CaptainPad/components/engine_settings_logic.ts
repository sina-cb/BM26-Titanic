/**
 * engine_settings_logic — PURE state derivations for the ENGINE SETTINGS card
 * (config.tsx → EngineSettingsCard). No React / react-native imports so vitest
 * can pin the logic in plain Node (same posture as deck_tx_logic.ts).
 *
 * The card owns exactly one setting today — `autoSave` — the engine-wide
 * persistence gate. These helpers cover the three behaviours the card needs:
 *   1. a DEFAULT-ON starting state (auto-save must never appear OFF before the
 *      engine has answered — the safe default is "your work is being saved"),
 *   2. an OPTIMISTIC toggle (flip locally on tap, POST, reconcile from the
 *      engine's authoritative echo), and
 *   3. a defensive RECONCILE from an engine payload (POST response body or the
 *      `engineSettings` WS broadcast) that ignores malformed fields.
 */

/**
 * Which face the ENGINE comes up in on its next start (report `_236`).
 *
 * `performance` — the shipped docs/56 D1 behaviour: an engine that has operator
 *   passcodes boots LOCKED behind the show lock, and a fresh passcode opens edit
 *   mode (and decides who owns persistence for that session).
 * `edit` — boot straight into the edit face. The passcode gate is NOT lifted:
 *   the engine starts with NO edit-session principal, so it persists nothing
 *   until someone identifies through the session chip. Editable rig, frozen
 *   disk.
 */
export type EngineBootMode = 'performance' | 'edit';

/** The engine-wide settings the card renders. */
export interface EngineSettingsState {
  autoSave: boolean;
  bootMode: EngineBootMode;
}

/**
 * DEFAULT-ON. Auto-save defaults to true both in the engine and here — the
 * card must never flash "OFF" before the first fetch lands, or the operator
 * would think their tuning is being dropped when it isn't.
 *
 * `bootMode` defaults to `performance` for the matching reason: it is the
 * engine's own default, and the safe direction for a show gate is ON. A pad that
 * painted "boots into EDIT" before the engine answered would be advertising an
 * unlocked rig it has not confirmed.
 */
export const DEFAULT_ENGINE_SETTINGS: EngineSettingsState = {
  autoSave: true,
  bootMode: 'performance',
};

/** Coerce an unknown value to a known boot mode, or null when it is neither. */
export function normalizeBootMode(value: unknown): EngineBootMode | null {
  return value === 'performance' || value === 'edit' ? value : null;
}

/**
 * Merge an engine payload into the current state, per-field, ignoring anything
 * that isn't the right type (mirrors the deckTransitionConfig reconcile in
 * index.tsx). A malformed/absent `autoSave` leaves the previous value intact
 * rather than blowing it away — and likewise `bootMode`, so a pre-`_236` engine
 * (which never sends the field) leaves the card's default in place instead of
 * inventing a boot face.
 */
export function reconcileEngineSettings(
  prev: EngineSettingsState,
  patch: unknown,
): EngineSettingsState {
  const p = (patch ?? {}) as { autoSave?: unknown; bootMode?: unknown };
  return {
    autoSave: typeof p.autoSave === 'boolean' ? p.autoSave : prev.autoSave,
    bootMode: normalizeBootMode(p.bootMode) ?? prev.bootMode,
  };
}

/** The optimistic next-state when the operator taps the toggle. */
export function toggledEngineSettings(prev: EngineSettingsState): EngineSettingsState {
  return { ...prev, autoSave: !prev.autoSave };
}

/**
 * Operator-facing hint for the current toggle position. Kept here (not inline
 * in JSX) so the exact wording is unit-testable and can't silently drift.
 */
export function autoSaveHint(autoSave: boolean): string {
  return autoSave
    ? 'All deck tuning, playlists, and mixer/global state persist automatically ' +
      '(mixer channel parameters are never saved).'
    : 'Nothing persists until you save explicitly — a restart reverts to the last save.';
}

/** The optimistic next-state when the operator picks a boot mode. */
export function withBootMode(
  prev: EngineSettingsState,
  bootMode: EngineBootMode,
): EngineSettingsState {
  return { ...prev, bootMode };
}

/**
 * Operator-facing hint for the boot-mode toggle. Says three things every time,
 * because all three have bitten someone: WHEN it applies (next engine start, not
 * now), WHAT the rig looks like, and — for EDIT — that the passcode gate is
 * still there, so nobody reads "boots into edit" as "boots wide open".
 */
export function bootModeHint(bootMode: EngineBootMode): string {
  return bootMode === 'edit'
    ? 'Takes effect on the NEXT engine start: the engine comes up in edit mode with '
      + 'no show lock. The passcode gate stays on — until someone enters a passcode '
      + 'on the session chip, the engine saves NOTHING to disk.'
    : 'Takes effect on the NEXT engine start: the engine comes up locked in '
      + 'performance mode with a pre-show snapshot, and a passcode opens edit mode.';
}

/** Label + one-line summary for each boot-mode option, pinned out of JSX. */
export const BOOT_MODE_OPTIONS: readonly {
  value: EngineBootMode; label: string; detail: string;
}[] = [
  {
    value: 'performance',
    label: 'PERFORMANCE',
    detail: 'Boots locked — passcode to edit.',
  },
  {
    value: 'edit',
    label: 'EDIT',
    detail: 'Boots unlocked — still no saving until a passcode.',
  },
];
