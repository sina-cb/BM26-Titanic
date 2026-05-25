/*
  trans_iris_close.js — Iris Close (radial collapse inward)
  Inverse of trans_iris: the outgoing pattern collapses inward toward
  the center (0.5, 0.5), revealing the new pattern from the edges in.
  Pixels far from the center see `to` first; the center is the last
  to switch.
  Uses transition built-ins: progress, fromR/G/B/W/A/U, toR/G/B/W/A/U
*/

export var feather = 0.08;
export function sliderFeather(v) { feather = 0.02 + v * 0.3; }

export function render(index, x, y, z) {
  // Normalized radial distance: 0 at center, ~1 at the corners.
  var dist = hypot(x - 0.5, y - 0.5) / 0.7071;
  // Edge ramps 0->1 as the closing iris consumes this pixel.
  // At progress=0 nothing is revealed (edge=0 everywhere);
  // at progress=1 every pixel has been consumed (edge=1).
  var edge = smoothstep(progress - feather, progress + feather, dist);
  rgbwau(
    mix(fromR, toR, edge),
    mix(fromG, toG, edge),
    mix(fromB, toB, edge),
    mix(fromW, toW, edge),
    mix(fromA, toA, edge),
    mix(fromU, toU, edge)
  );
}
