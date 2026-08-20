/**
 * rgbwau_blend.js — the canonical RGBWAU → display-RGB blend used by the 3D
 * pixel dots, factored out so the 2D Pixel Map renders identical colors by
 * construction (no drift from a hand-copied formula).
 *
 * White/Amber/UV are additive contributions on top of the base RGB, weighted
 * to approximate how those emitters read on the physical fixtures. Values are
 * normalized (0..1) in and out.
 */

import { isLedEntry, resolveLedWireConfig, ledPreviewRgb } from '../dmx/led_wire.js';

/** RGBWAU (0..1) → display [r, g, b] (0..1), clamped. */
export function blendRgbwau(r, g, b, w, a, u) {
  return [
    Math.min(1, (r || 0) + (w || 0) * 0.8 + (a || 0) * 0.9 + (u || 0) * 0.4),
    Math.min(1, (g || 0) + (w || 0) * 0.8 + (a || 0) * 0.6),
    Math.min(1, (b || 0) + (w || 0) * 0.8 + (u || 0) * 0.7),
  ];
}

/**
 * Display RGB for ONE render-list entry.
 *
 * DMX fixtures use the additive RGBWAU blend above — they really do have
 * white, amber and UV emitters, so the blend is an honest preview.
 *
 * LED STRANDS do not: they carry RGB(W) only, and everything they show
 * has been through the wire encode plus the LED controller's own white
 * processing and gamma. So a strand's preview is computed from its WIRE
 * BYTES (led_wire.js) — amber folded in, UV dropped, no clipping — and
 * NOT from the optimistic blend, which used to advertise warmth and UV
 * the hardware never receives. `_ledWirePreview` is the cached result
 * when a frame's bytes have already been computed this frame (sACN-out
 * map) or received (sACN-in demap); otherwise it is derived from the
 * render lanes, which is the same math.
 */
export function blendEntryRgbwau(entry) {
  if (!isLedEntry(entry)) {
    return blendRgbwau(entry.r, entry.g, entry.b, entry.w, entry.a, entry.u);
  }
  if (entry._ledWirePreview) return entry._ledWirePreview;
  return ledPreviewRgb(entry.r, entry.g, entry.b, entry.w, entry.a,
    resolveLedWireConfig(entry), entry.whiteMode === 'synth' ? 'synth' : 'native');
}

/**
 * Display RGB for a _batchRenderList entry, replicating the 3D flush-loop
 * branch: when patches are active and this entry is unpatched it is black
 * (or diagnostic red when the operator enabled the unpatched-red overlay).
 * Otherwise it's the per-entry blend. Does NOT apply sim-exposure preview
 * scaling — callers that mirror the 3D preview must scale separately.
 */
export function entryDisplayRgb(entry, patchesActive, showUnpatchedRed) {
  if (patchesActive && (!entry.patch || !entry.patch.universe || entry.patch.universe <= 0)) {
    return showUnpatchedRed ? [0.8, 0, 0] : [0, 0, 0];
  }
  return blendEntryRgbwau(entry);
}
