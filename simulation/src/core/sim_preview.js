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

export function scaleSimulationPreviewRgb(r, g, b) {
  const scale = getSimulationBrightness();
  return [
    clampUnit(Number(r) * scale),
    clampUnit(Number(g) * scale),
    clampUnit(Number(b) * scale),
  ];
}
