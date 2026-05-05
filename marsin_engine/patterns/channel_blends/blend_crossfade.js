/*
  blend_crossfade.js — Linear Crossfade Transition
  Simple linear interpolation between outgoing and incoming patterns.
  Uses transition built-ins: progress, fromR/G/B/W/A/U, toR/G/B/W/A/U
*/

export function render(index, x, y, z) {
  rgbwau(
    mix(fromR, toR, progress),
    mix(fromG, toG, progress),
    mix(fromB, toB, progress),
    mix(fromW, toW, progress),
    mix(fromA, toA, progress),
    mix(fromU, toU, progress)
  );
}
