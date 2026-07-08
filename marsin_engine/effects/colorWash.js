/**
 * effects/colorWash.js — Color Wash Takeover / Palette Override
 *
 * Stateless tint/replace/multiply/max blender on the post-mixer pixel
 * buffer. Active wash config (preset, amount, mode) is held by
 * GlobalEffectsController.
 */

export function applyColorWash({ pixels, color6, amount, mode = 'tint' }) {
  if (!Array.isArray(color6) || color6.length < 6) {
    throw new Error('applyColorWash: color6 must be a 6-element array');
  }
  const a = Math.max(0, Math.min(1, amount));
  if (a <= 0) return;
  const ia = 1 - a;

  for (let i = 0; i < pixels.length; i++) {
    const px = pixels[i];

    if (mode === 'replace') {
      px.r = px.r * ia + color6[0] * a;
      px.g = px.g * ia + color6[1] * a;
      px.b = px.b * ia + color6[2] * a;
      px.w = px.w * ia + color6[3] * a;
      px.a = px.a * ia + color6[4] * a;
      px.u = px.u * ia + color6[5] * a;
    } else if (mode === 'multiply') {
      px.r *= ia + color6[0] * a;
      px.g *= ia + color6[1] * a;
      px.b *= ia + color6[2] * a;
      px.w *= ia + color6[3] * a;
      px.a *= ia + color6[4] * a;
      px.u *= ia + color6[5] * a;
    } else if (mode === 'max') {
      px.r = Math.max(px.r, color6[0] * a);
      px.g = Math.max(px.g, color6[1] * a);
      px.b = Math.max(px.b, color6[2] * a);
      px.w = Math.max(px.w, color6[3] * a);
      px.a = Math.max(px.a, color6[4] * a);
      px.u = Math.max(px.u, color6[5] * a);
    } else {
      // Default 'tint' — a TRUE lerp toward the tint target: px*(1-a) +
      // color*a. The pre-2026-07 formula was a muddy additive hybrid
      // (`px*ia + (px+c)*0.5*a`) that BRIGHTENED as it tinted (the `px`
      // term appears in both halves), so a wash never reached the target
      // color and always pushed luminance up. This clean lerp keeps
      // luminance where the mixer put it and lands exactly on `color6` at
      // amount=1. Mathematically identical to 'replace' — 'tint' stays a
      // distinct named mode so presets/UI read intuitively and a future
      // curve tweak has a home. W/A/UV are lerp'd the same as 'replace'
      // (this is a brightness-family wash, not a chroma op).
      px.r = px.r * ia + color6[0] * a;
      px.g = px.g * ia + color6[1] * a;
      px.b = px.b * ia + color6[2] * a;
      px.w = px.w * ia + color6[3] * a;
      px.a = px.a * ia + color6[4] * a;
      px.u = px.u * ia + color6[5] * a;
    }
  }
}

export const colorWashEffect = {
  apply: applyColorWash,
};
