/**
 * effects/fogger.js — Haze/fog DMX-fixture trigger
 *
 * The fogger is wired directly to DMX (not pixel-buffer) — the legacy
 * GlobalEffectsController.applyDmx() drives it. This module is a
 * placeholder so the unified Global Effect Macros library can expose
 * `fogger` as a togglable slot effect without duplicating the DMX
 * trigger logic. The slot dispatcher flips
 * `controller.effects.fogger` and the existing applyDmx() path takes
 * over from there.
 */

export const foggerEffect = {
  // No pixel-buffer apply — the DMX path in GlobalEffectsController
  // handles output writes. Apply is a no-op so test harnesses can
  // exercise the registry uniformly.
  apply(_args) {
    // intentionally empty
  },
};
