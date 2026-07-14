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

/** The single engine-wide setting the card renders. */
export interface EngineSettingsState {
  autoSave: boolean;
}

/**
 * DEFAULT-ON. Auto-save defaults to true both in the engine and here — the
 * card must never flash "OFF" before the first fetch lands, or the operator
 * would think their tuning is being dropped when it isn't.
 */
export const DEFAULT_ENGINE_SETTINGS: EngineSettingsState = { autoSave: true };

/**
 * Merge an engine payload into the current state, per-field, ignoring anything
 * that isn't the right type (mirrors the deckTransitionConfig reconcile in
 * index.tsx). A malformed/absent `autoSave` leaves the previous value intact
 * rather than blowing it away.
 */
export function reconcileEngineSettings(
  prev: EngineSettingsState,
  patch: unknown,
): EngineSettingsState {
  const p = (patch ?? {}) as { autoSave?: unknown };
  return {
    autoSave: typeof p.autoSave === 'boolean' ? p.autoSave : prev.autoSave,
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
