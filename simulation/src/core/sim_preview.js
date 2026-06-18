import { params } from './state.js';

export function clampUnit(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.min(1, Math.max(0, numeric));
}

export function getSimulationBrightness() {
  const raw = Number(params.simBrightness);
  if (!Number.isFinite(raw)) return 1;
  return Math.max(0, raw);
}

export function getSimulationSurfaceReflectance() {
  const raw = Number(params.simSurfaceReflectance);
  if (!Number.isFinite(raw)) return 1;
  return clampUnit(raw);
}

export function applySimulationSurfaceReflectanceToMaterial(material) {
  if (!material || !material.color) return;
  if (!(material.isMeshStandardMaterial || material.isMeshPhysicalMaterial)) return;

  if (!material.userData) material.userData = {};
  if (!material.userData._simPreviewBaseColor) {
    material.userData._simPreviewBaseColor = material.color.clone();
  }

  material.color
    .copy(material.userData._simPreviewBaseColor)
    .multiplyScalar(getSimulationSurfaceReflectance());
}

/**
 * Mix an RGBWAU pixel down to RGB for preview, using the EXACT weights
 * the firmware applies in MarsinPixel::toRGBFallback
 * (MarsinLED/src/MarsinPixel.cpp), so what the sim shows on an LED strand
 * matches what the WS2812-RGBW driver would emit when it has no dedicated
 * W/A/U hardware:
 *   outR = min(1, r + w + a*0.8 + u*0.1)
 *   outG = min(1, g + w + a*0.4)
 *   outB = min(1, b + w + u*0.5)
 * Inputs and outputs are 0..1. White (w) drives all three channels fully,
 * so a pattern calling rgbwau(...,w,...) lights the strand visibly white.
 */
export function mixRgbwauToRgb(r, g, b, w = 0, a = 0, u = 0) {
  const rn = Math.min(1, Number(r) + Number(w) + Number(a) * 0.8 + Number(u) * 0.1);
  const gn = Math.min(1, Number(g) + Number(w) + Number(a) * 0.4);
  const bn = Math.min(1, Number(b) + Number(w) + Number(u) * 0.5);
  return [Math.max(0, rn), Math.max(0, gn), Math.max(0, bn)];
}

export function scaleSimulationPreviewRgb(r, g, b) {
  const scale = getSimulationBrightness();
  return [
    clampUnit(Number(r) * scale),
    clampUnit(Number(g) * scale),
    clampUnit(Number(b) * scale),
  ];
}
