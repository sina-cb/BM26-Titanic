/**
 * rgbwau_blend.js — the canonical RGBWAU → display-RGB blend used by the 3D
 * pixel dots, factored out so the 2D Pixel Map renders identical colors by
 * construction (no drift from a hand-copied formula).
 *
 * White/Amber/UV are additive contributions on top of the base RGB, weighted
 * to approximate how those emitters read on the physical fixtures. Values are
 * normalized (0..1) in and out.
 */

/** RGBWAU (0..1) → display [r, g, b] (0..1), clamped. */
export function blendRgbwau(r, g, b, w, a, u) {
  return [
    Math.min(1, (r || 0) + (w || 0) * 0.8 + (a || 0) * 0.9 + (u || 0) * 0.4),
    Math.min(1, (g || 0) + (w || 0) * 0.8 + (a || 0) * 0.6),
    Math.min(1, (b || 0) + (w || 0) * 0.8 + (u || 0) * 0.7),
  ];
}

/**
 * Display RGB for a _batchRenderList entry, replicating the 3D flush-loop
 * branch: when patches are active and this entry is unpatched it is black
 * (or diagnostic red when the operator enabled the unpatched-red overlay).
 * Otherwise it's the RGBWAU blend. Does NOT apply sim-exposure preview
 * scaling — callers that mirror the 3D preview must scale separately.
 */
export function entryDisplayRgb(entry, patchesActive, showUnpatchedRed) {
  if (patchesActive && (!entry.patch || !entry.patch.universe || entry.patch.universe <= 0)) {
    return showUnpatchedRed ? [0.8, 0, 0] : [0, 0, 0];
  }
  return blendRgbwau(entry.r, entry.g, entry.b, entry.w, entry.a, entry.u);
}
