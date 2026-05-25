/*
  trans_diamond_wipe.js — Diamond Wipe (expanding diamond from center)
  Uses Manhattan (L1) distance from the center so the wipe boundary
  forms a rotated square / diamond shape that grows outward as
  progress ramps 0 -> 1. Visually distinct from the round iris.
  Uses transition built-ins: progress, fromR/G/B/W/A/U, toR/G/B/W/A/U
*/

export var feather = 0.08;
export function sliderFeather(v) { feather = 0.02 + v * 0.3; }

export function render(index, x, y, z) {
  // L1 (Manhattan) distance from center. Max value is 1.0
  // when (x,y) is at any corner — so no normalization needed.
  var dist = abs(x - 0.5) + abs(y - 0.5);
  var edge = smoothstep(progress - feather, progress + feather, 1.0 - dist);
  rgbwau(
    mix(fromR, toR, edge),
    mix(fromG, toG, edge),
    mix(fromB, toB, edge),
    mix(fromW, toW, edge),
    mix(fromA, toA, edge),
    mix(fromU, toU, edge)
  );
}
