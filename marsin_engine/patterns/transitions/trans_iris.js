/*
  blend_iris.js — Iris/Radial Wipe Transition
  Expands from center outward (or collapses inward).
  Uses transition built-ins: progress, fromR/G/B/W/A/U, toR/G/B/W/A/U
*/

export var feather = 0.08;
export function sliderFeather(v) { feather = 0.02 + v * 0.3; }

export function render(index, x, y, z) {
  var dist = abs(x - 0.5) * 2;
  var edge = smoothstep(progress - feather, progress + feather, 1 - dist);
  rgbwau(
    mix(fromR, toR, edge),
    mix(fromG, toG, edge),
    mix(fromB, toB, edge),
    mix(fromW, toW, edge),
    mix(fromA, toA, edge),
    mix(fromU, toU, edge)
  );
}
