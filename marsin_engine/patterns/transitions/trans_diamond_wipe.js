/*
  trans_diamond_wipe.js — Diamond Wipe (expanding diamond from center)
  Uses Manhattan (L1) distance from the center so the wipe boundary
  forms a rotated square / diamond shape that grows outward as
  `progress` ramps 0 -> 1. Visually distinct from the round iris.

  Pixel-perfect endpoints — see trans_wipe_right.js docstring for the
  bias rationale.
  Uses transition built-ins: progress, fromR/G/B/W/A/U, toR/G/B/W/A/U
*/

export var feather = 0.08;
export function sliderFeather(v) { feather = 0.02 + v * 0.3; }

export function render(index, x, y, z) {
  // L1 distance from center: 0 at center, 1 at any of the four corners
  // (max(|0-0.5|+|0-0.5|, |1-0.5|+|1-0.5|) = 1.0). pp = L1 distance,
  // so the center reveals first.
  var pp = abs(x - 0.5) + abs(y - 0.5);
  var ep = progress * (1.0 + 2.0 * feather) - feather;
  var edge = smoothstep(pp - feather, pp + feather, ep);
  rgbwau(
    mix(fromR, toR, edge),
    mix(fromG, toG, edge),
    mix(fromB, toB, edge),
    mix(fromW, toW, edge),
    mix(fromA, toA, edge),
    mix(fromU, toU, edge)
  );
}
