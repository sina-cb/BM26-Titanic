/*
  blend_add.js — Additive Blend Mode
  Simple additive compositing: out = from + to * progress
  Great for layering glow effects. Can clip above 1.0.
  Uses transition built-ins: progress, fromR/G/B/W/A/U, toR/G/B/W/A/U
*/

export function render(index, x, y, z) {
  rgbwau(
    clamp(fromR + toR * progress, 0, 1),
    clamp(fromG + toG * progress, 0, 1),
    clamp(fromB + toB * progress, 0, 1),
    clamp(fromW + toW * progress, 0, 1),
    clamp(fromA + toA * progress, 0, 1),
    clamp(fromU + toU * progress, 0, 1)
  );
}
