/**
 * effects/djLights.js — DJ Lights group color override
 *
 * Targets only pixels belonging to the 'DJLights' group and replaces
 * their color output with a configurable color at a given brightness.
 * Applied in GlobalEffectsController.applyPixels() alongside other
 * legacy rig-globals so it runs before intensity dimming.
 */

export function applyDjLights({ pixels, color6, brightness }) {
  const b = Math.max(0, Math.min(1, brightness));
  if (b <= 0) return;

  for (let i = 0; i < pixels.length; i++) {
    const px = pixels[i];
    if (px.group !== 'DJLights') continue;

    px.r = color6[0] * b;
    px.g = color6[1] * b;
    px.b = color6[2] * b;
    px.w = (color6[3] || 0) * b;
    px.a = (color6[4] || 0) * b;
    px.u = (color6[5] || 0) * b;
  }
}

export const djLightsEffect = {
  apply: applyDjLights,
};
